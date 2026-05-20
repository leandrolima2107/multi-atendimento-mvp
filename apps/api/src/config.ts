import { ConfigService } from '@nestjs/config';

export function requiredConfig(config: ConfigService, key: string) {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`${key} obrigatório.`);
  }
  return value;
}
