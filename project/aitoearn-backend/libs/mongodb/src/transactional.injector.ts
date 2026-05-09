import type { Injectable } from '@nestjs/common/interfaces'
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable as InjectableDec, Logger, OnModuleInit } from '@nestjs/common'
import { MetadataScanner, ModulesContainer } from '@nestjs/core'
import { InjectConnection } from '@nestjs/mongoose'
import { TransactionOptions } from 'mongodb'
import { Connection } from 'mongoose'
import { TRANSACTIONAL_METADATA } from './decorators/transactional.decorator'

interface TransactionContext {
  inTransaction: boolean
}

@InjectableDec()
export class TransactionalInjector implements OnModuleInit {
  private readonly logger = new Logger(TransactionalInjector.name)
  private readonly metadataScanner: MetadataScanner = new MetadataScanner()
  private readonly transactionContext = new AsyncLocalStorage<TransactionContext>()
  private transactionsSupported = true

  constructor(
    private readonly modulesContainer: ModulesContainer,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    this.transactionsSupported = await this.detectTransactionsSupported()
    if (!this.transactionsSupported) {
      this.logger.warn('MongoDB transactions are not supported by the current topology; @Transactional methods will run without transactions')
    }

    for (const provider of this.getProviders()) {
      this.injectToProvider(provider)
    }
  }

  private async detectTransactionsSupported(): Promise<boolean> {
    try {
      const db = this.connection.db
      if (!db) {
        return true
      }

      const hello = await db.admin().command({ hello: 1 })
      return Boolean(hello['setName'] || hello['msg'] === 'isdbgrid')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to detect MongoDB transaction support; assuming supported: ${message}`)
      return true
    }
  }

  private* getProviders(): Generator<InstanceWrapper<Injectable>> {
    for (const module of this.modulesContainer.values()) {
      for (const provider of module.providers.values()) {
        if (provider && provider.metatype?.prototype) {
          yield provider as InstanceWrapper<Injectable>
        }
      }
    }
  }

  private injectToProvider(wrapper: InstanceWrapper<Injectable>): void {
    const { metatype } = wrapper
    if (!metatype)
      return

    const prototype = metatype.prototype
    const methodNames = this.metadataScanner.getAllMethodNames(prototype)

    for (const methodName of methodNames) {
      const method = prototype[methodName]
      if (this.isDecorated(method)) {
        const options = this.getDecoratorOptions(method)
        const wrappedMethod = this.wrapMethod(method, methodName, prototype.constructor.name, options)
        this.reDecorate(method, wrappedMethod)
        prototype[methodName] = wrappedMethod
        this.logger.log(`Injected transaction to ${prototype.constructor.name}.${methodName}`)
      }
    }
  }

  private isDecorated(target: object): boolean {
    return Reflect.hasMetadata(TRANSACTIONAL_METADATA, target)
  }

  private getDecoratorOptions(target: object): TransactionOptions {
    return Reflect.getMetadata(TRANSACTIONAL_METADATA, target)
  }

  private reDecorate(source: object, destination: object): void {
    const keys = Reflect.getMetadataKeys(source)
    for (const key of keys) {
      const meta = Reflect.getMetadata(key, source)
      Reflect.defineMetadata(key, meta, destination)
    }
  }

  private wrapMethod(
    originalMethod: (...args: unknown[]) => unknown,
    methodName: string,
    className: string,
    options: TransactionOptions,
  ): (...args: unknown[]) => unknown {
    return new Proxy(originalMethod, {
      apply: async (target, thisArg, args: unknown[]) => {
        const fullMethodName = `${className}.${methodName}`

        if (!this.transactionsSupported) {
          this.logger.debug(`Running transactional method without MongoDB transaction: ${fullMethodName}`)
          return Reflect.apply(target, thisArg, args)
        }

        const currentContext = this.transactionContext.getStore()
        if (currentContext?.inTransaction) {
          this.logger.debug(`Skipping nested transaction for ${fullMethodName}`)
          return Reflect.apply(target, thisArg, args)
        }

        this.logger.debug(`Executing transactional method: ${fullMethodName}`)

        return this.transactionContext.run(
          { inTransaction: true },
          () => this.connection.transaction(
            () => Reflect.apply(target, thisArg, args) as Promise<unknown>,
            options,
          ),
        )
      },
    })
  }
}
