import { Module } from '@nestjs/common'
import { AccountModule } from '../account/account.module'
import { BilibiliModule } from '../channel/platforms/bilibili/bilibili.module'
import { ChannelSharedModule } from '../channel/platforms/channel-shared.module'
import { YoutubeModule } from '../channel/platforms/youtube/youtube.module'
import { PublishModule as PublishingModule } from '../channel/publishing/publishing.module'
import { ContentModule } from '../content/content.module'
import { NotificationModule } from '../notification/notification.module'
import { PublishModule } from '../publish-record/publish-record.module'
import { ShortLinkModule } from '../short-link/short-link.module'
import { UserModule } from '../user/user.module'
import { AccountController } from './account.controller'
import { MaterialInternalController } from './material.controller'
import { NotificationInternalController } from './notification.controller'
import { OrchestrationDraftInternalController } from './orchestration-draft.controller'
import { OrchestrationOutcomeInternalController } from './orchestration-outcome.controller'
import { OrchestrationPublishingIntentController } from './orchestration-publishing-intent.controller'
import { AccountInternalService } from './provider/account.service'
import { PublishingInternalService } from './provider/publishing.service'
import { PublishRecordController } from './publish-record.controller'
import { PublishingController } from './publishing.controller'
import { ShortLinkController } from './short-link.controller'
import { UserInternalController } from './user.controller'

@Module({
  imports: [
    BilibiliModule,
    ChannelSharedModule,
    YoutubeModule,
    PublishingModule,
    UserModule,
    AccountModule,
    PublishModule,
    NotificationModule,
    ContentModule,
    ShortLinkModule,
  ],
  providers: [AccountInternalService, PublishingInternalService],
  controllers: [
    UserInternalController,
    AccountController,
    NotificationInternalController,
    PublishingController,
    MaterialInternalController,
    OrchestrationDraftInternalController,
    OrchestrationOutcomeInternalController,
    OrchestrationPublishingIntentController,
    PublishRecordController,
    ShortLinkController,
  ],
})
export class InternalModule {}
