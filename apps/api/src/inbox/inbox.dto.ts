import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body!: string;
}

export class SendMediaMessageDto {
  @IsIn(['image', 'audio', 'video', 'document'])
  type!: 'image' | 'audio' | 'video' | 'document';

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(140)
  mimeType!: string;

  @IsInt()
  @Min(1)
  size!: number;

  @IsString()
  @MinLength(1)
  dataBase64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class ListInboxDto {
  @IsOptional()
  @IsString()
  status?: string;
}
