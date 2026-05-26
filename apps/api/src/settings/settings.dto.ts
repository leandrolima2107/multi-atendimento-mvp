import { IsString, IsUrl } from 'class-validator';

export class UpdateEvolutionWebhookUrlDto {
  @IsString()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'Informe uma URL HTTP ou HTTPS válida.' },
  )
  webhookPublicUrl!: string;
}
