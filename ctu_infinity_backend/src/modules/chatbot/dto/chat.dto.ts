import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatDto {
  @IsString()
  @MinLength(1, { message: 'Câu hỏi không được để trống' })
  @MaxLength(2000, { message: 'Câu hỏi không được vượt quá 2000 ký tự' })
  question: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
