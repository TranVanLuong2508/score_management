import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class IngestTextDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class AskQuestionDto {
  @IsString()
  @IsNotEmpty()
  question: string;
}
