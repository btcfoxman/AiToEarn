import type { SocialAccount } from '@/api/types/account.type'
import type { PubItem } from '@/components/PublishDialog/publishDialog.type'
import { expect, test } from '@playwright/test'
import {
  areValidationMapsEqual,
  reconcilePublishAccounts,
} from '@/components/PublishDialog/publishDialogStateSync'

function makeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'account-1',
    type: 'xhs' as SocialAccount['type'],
    loginTime: '2026-07-16T00:00:00.000Z',
    uid: 'xhs-user-1',
    account: 'xhs-user-1',
    avatar: '',
    nickname: 'Operator account',
    fansCount: 0,
    readCount: 0,
    likeCount: 0,
    collectCount: 0,
    forwardCount: 0,
    commentCount: 0,
    lastStatsTime: '2026-07-16T00:00:00.000Z',
    workCount: 0,
    income: 0,
    status: 1,
    createTime: '2026-07-16T00:00:00.000Z',
    updateTime: '2026-07-16T00:00:00.000Z',
    rank: 0,
    groupId: 'default',
    ...overrides,
  }
}

function makePubItem(account: SocialAccount): PubItem {
  return {
    account,
    params: { option: {}, images: [], des: '' },
  } as PubItem
}

test('equivalent account data keeps all publish item references stable', () => {
  const account = makeAccount()
  const item = makePubItem(account)
  const reconciled = reconcilePublishAccounts(
    [{ ...account }],
    { pubList: [item], pubListChoosed: [item], expandedPubItem: item },
    makePubItem,
  )

  expect(reconciled.changed).toBe(false)
  expect(reconciled.pubList[0]).toBe(item)
  expect(reconciled.pubListChoosed[0]).toBe(item)
  expect(reconciled.expandedPubItem).toBe(item)
})

test('changed account metadata is applied once and is idempotent afterwards', () => {
  const account = makeAccount()
  const item = makePubItem(account)
  const first = reconcilePublishAccounts(
    [makeAccount({ nickname: 'Updated operator account' })],
    { pubList: [item], pubListChoosed: [item], expandedPubItem: item },
    makePubItem,
  )

  expect(first.changed).toBe(true)
  expect(first.pubList[0].account.nickname).toBe('Updated operator account')

  const second = reconcilePublishAccounts(
    [makeAccount({ nickname: 'Updated operator account' })],
    first,
    makePubItem,
  )
  expect(second.changed).toBe(false)
  expect(second.pubList[0]).toBe(first.pubList[0])
})

test('equivalent validation maps are recognized without relying on reference equality', () => {
  const current = new Map([
    ['account-1', { parErrMsg: 'Missing media', parErrMsgs: ['Missing media'] }],
  ])
  const next = new Map([
    ['account-1', { parErrMsg: 'Missing media', parErrMsgs: ['Missing media'] }],
  ])

  expect(areValidationMapsEqual(current, next)).toBe(true)
})
