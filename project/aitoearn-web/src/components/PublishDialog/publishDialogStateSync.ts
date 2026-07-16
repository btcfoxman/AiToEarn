import type { SocialAccount } from '@/api/types/account.type'
import type { PubItem } from '@/components/PublishDialog/publishDialog.type'
import type { ErrPubParamsMapType } from '@/components/PublishDialog/hooks/usePubParamsVerify'
import lodash from 'lodash'

type PublishDialogAccountState = Pick<
  { pubList: PubItem[], pubListChoosed: PubItem[], expandedPubItem?: PubItem },
  'pubList' | 'pubListChoosed' | 'expandedPubItem'
>

function getSocialAccountIdentityKeys(account: Pick<SocialAccount, 'account' | 'id' | 'type' | 'uid'>) {
  const keys = [`id:${account.id}`]
  if (account.uid)
    keys.push(`uid:${account.type}:${account.uid}`)
  if (account.account)
    keys.push(`account:${account.type}:${account.account}`)
  return keys
}

function isSameSocialAccount(
  current: Pick<SocialAccount, 'account' | 'id' | 'type' | 'uid'>,
  next: Pick<SocialAccount, 'account' | 'id' | 'type' | 'uid'>,
) {
  if (current.id === next.id)
    return true
  if (current.type !== next.type)
    return false
  if (current.uid && next.uid && current.uid === next.uid)
    return true
  return Boolean(current.account && next.account && current.account === next.account)
}

function dedupePublishAccounts(accounts: SocialAccount[]) {
  return accounts.reduce<SocialAccount[]>((result, accountItem) => {
    const existingIndex = result.findIndex(item => isSameSocialAccount(item, accountItem))
    if (existingIndex === -1)
      result.push(accountItem)
    else
      result[existingIndex] = accountItem
    return result
  }, [])
}

function setPubItemIdentityMap(target: Map<string, PubItem>, pubItem: PubItem) {
  getSocialAccountIdentityKeys(pubItem.account).forEach((key) => {
    if (!target.has(key))
      target.set(key, pubItem)
  })
}

function getPubItemByAccount(target: Map<string, PubItem>, account: SocialAccount) {
  for (const key of getSocialAccountIdentityKeys(account)) {
    const pubItem = target.get(key)
    if (pubItem)
      return pubItem
  }
  return undefined
}

function isSamePubItemList(current: PubItem[], next: PubItem[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}

export function areValidationMapsEqual(
  current: ErrPubParamsMapType | undefined,
  next: ErrPubParamsMapType,
) {
  return lodash.isEqual(current, next)
}

export function reconcilePublishAccounts(
  accounts: SocialAccount[],
  current: PublishDialogAccountState,
  createPubItem: (account: SocialAccount) => PubItem,
) {
  const dedupedAccounts = dedupePublishAccounts(accounts)
  if (dedupedAccounts.length === 0 && current.pubList.length > 0) {
    return { changed: false, accounts: dedupedAccounts, ...current }
  }

  const currentPubItemMap = new Map<string, PubItem>()
  current.pubList.forEach(pubItem => setPubItemIdentityMap(currentPubItemMap, pubItem))
  current.pubListChoosed.forEach(pubItem => setPubItemIdentityMap(currentPubItemMap, pubItem))
  if (current.expandedPubItem)
    setPubItemIdentityMap(currentPubItemMap, current.expandedPubItem)

  const pubList = dedupedAccounts.map((accountItem) => {
    const currentPubItem = getPubItemByAccount(currentPubItemMap, accountItem)
    if (!currentPubItem)
      return createPubItem(accountItem)
    if (lodash.isEqual(currentPubItem.account, accountItem))
      return currentPubItem
    return { ...currentPubItem, account: accountItem }
  })

  const nextPubItemMap = new Map<string, PubItem>()
  pubList.forEach(pubItem => setPubItemIdentityMap(nextPubItemMap, pubItem))
  const pubListChoosed = current.pubListChoosed
    .map(pubItem => getPubItemByAccount(nextPubItemMap, pubItem.account))
    .filter((pubItem): pubItem is PubItem => Boolean(pubItem))
  const expandedPubItem = current.expandedPubItem
    ? getPubItemByAccount(nextPubItemMap, current.expandedPubItem.account)
    : undefined

  const changed = !(
    isSamePubItemList(current.pubList, pubList)
    && isSamePubItemList(current.pubListChoosed, pubListChoosed)
    && current.expandedPubItem === expandedPubItem
  )

  return {
    changed,
    accounts: dedupedAccounts,
    pubList,
    pubListChoosed,
    expandedPubItem,
  }
}
