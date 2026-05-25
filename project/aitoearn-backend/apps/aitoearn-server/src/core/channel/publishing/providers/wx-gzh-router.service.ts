import { Injectable } from '@nestjs/common'
import { PublishRecord } from '@yikart/mongodb'
import { ChannelAccountService } from '../../platforms/channel-account.service'
import { CreatePublishDto } from '../publish.dto'
import { PublishingTaskResult, VerifyPublishResult } from '../publishing.interface'
import { PublishService } from './base.service'
import { OrchestrationPublishService } from './orchestration.service'
import { WxGzhPubService } from './wx-gzh.service'

@Injectable()
export class WxGzhPublishRouterService extends PublishService {
  constructor(
    private readonly legacyWxGzh: WxGzhPubService,
    private readonly orchestration: OrchestrationPublishService,
    private readonly channelAccountService: ChannelAccountService,
  ) {
    super()
  }

  override async validatePublishParams(publishTask: CreatePublishDto): Promise<{ success: boolean, message?: string }> {
    if (await this.isOrchestrationAccount(publishTask.accountId)) {
      return this.orchestration.validatePublishParams(publishTask)
    }
    return this.legacyWxGzh.validatePublishParams(publishTask)
  }

  async immediatePublish(publishTask: PublishRecord): Promise<PublishingTaskResult> {
    if (await this.isOrchestrationAccount(publishTask.accountId)) {
      return this.orchestration.immediatePublish(publishTask)
    }
    return this.legacyWxGzh.immediatePublish(publishTask)
  }

  async verifyAndCompletePublish(publishRecord: PublishRecord): Promise<VerifyPublishResult> {
    if (await this.isOrchestrationAccount(publishRecord.accountId)) {
      return this.orchestration.verifyAndCompletePublish(publishRecord)
    }
    return this.legacyWxGzh.verifyAndCompletePublish(publishRecord)
  }

  private async isOrchestrationAccount(accountId?: string) {
    if (!accountId) {
      return false
    }
    const account = await this.channelAccountService.getAccountInfo(accountId)
    return account?.externalProvider === 'ai-orchestration'
  }
}
