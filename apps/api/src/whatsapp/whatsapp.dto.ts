import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWhatsappInstanceDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
