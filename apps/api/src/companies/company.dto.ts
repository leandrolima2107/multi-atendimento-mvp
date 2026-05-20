import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  slug!: string;

  @IsOptional()
  @IsString()
  planId?: string;
}

export class CreatePlanDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsInt()
  @Min(1)
  maxWhatsappInstances!: number;

  @IsInt()
  @Min(1)
  maxUsers!: number;
}
