import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { InboxModule } from './inbox/inbox.module';
import { LeadsModule } from './leads/leads.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SettingsModule } from './settings/settings.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { HealthController } from './health.controller';
import { requiredConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requiredConfig(config, 'JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
    PrismaModule,
    RealtimeModule,
    SettingsModule,
    AuthModule,
    CompaniesModule,
    WhatsappModule,
    WebhooksModule,
    InboxModule,
    LeadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
