import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { CreateCriteriaDto } from './dto/create-criteria.dto';
import { UpdateCriteriaDto } from './dto/update-criteria.dto';
import { QueryCriteriaDto } from './dto/query-criteria.dto';
import { Criteria } from './entities/criteria.entity';
import { CriteriaFrame } from '../criteria-frame/entities/criteria-frame.entity';
import { FrameworkStatus } from 'src/common/enums/framework-status.enum';
import { validateUUID } from 'src/common/validateUUID';

@Injectable()
export class CriteriasService {
  constructor(
    @InjectRepository(Criteria)
    private criteriaRepository: Repository<Criteria>,
    @InjectRepository(CriteriaFrame)
    private criteriaFrameRepository: Repository<CriteriaFrame>,
  ) {}

  /**
   * Convert number to Roman numerals (for level 1 criteriaaaaa)
   */
  private toRoman(num: number): string {
    const romanNumerals = [
      // { value: 1000, symbol: 'M' },
      // { value: 900, symbol: 'CM' },
      // { value: 500, symbol: 'D' },
      // { value: 400, symbol: 'CD' },
      // { value: 100, symbol: 'C' },
      // { value: 90, symbol: 'XC' },
      // { value: 50, symbol: 'L' },
      // { value: 40, symbol: 'XL' },
      { value: 10, symbol: 'X' },
      { value: 9, symbol: 'IX' },
      { value: 5, symbol: 'V' },
      { value: 4, symbol: 'IV' },
      { value: 1, symbol: 'I' },
    ];

    let result = '';
    for (const { value, symbol } of romanNumerals) {
      while (num >= value) {
        result += symbol;
        num -= value;
      }
    }
    return result;
  }

  /**
   * Convert number to lowercase letter (1=a, 2=b, ..., 26=z, 27=aa, ...)
   */
  private toLetter(num: number): string {
    let result = '';
    while (num > 0) {
      const remainder = (num - 1) % 26;
      result = String.fromCharCode(97 + remainder) + result;
      num = Math.floor((num - 1) / 26);
    }
    return result;
  }

  /**
   * Calculate the level of a criteria by counting parents
   */
  private async calculateLevel(criteriaId: string): Promise<number> {
    const criteria = await this.criteriaRepository.findOne({
      where: { criteriaId },
      relations: ['parent'],
    });

    if (!criteria) {
      return 0;
    }

    if (!criteria.parentId) {
      return 1; // Root level
    }

    return 1 + (await this.calculateLevel(criteria.parentId));
  }

  /**
   * Check if a criteria is a leaf (has no children)
   */
  private async isLeafCriteria(criteriaId: string): Promise<boolean> {
    const childrenCount = await this.criteriaRepository.count({
      where: { parentId: criteriaId },
    });
    return childrenCount === 0;
  }

  /**
   * Format:
   * - Level 1: I, II, III, IV, ... (Roman numerals)
   * - Level 2: a, b, c, ... (lowercase letters)
   * - Level 3: 1, 2, 3, ... (numbers)
   * - Level 4+: Continue with numbers
   */
  private async generateCriteriaCode(
    parentId: string | null,
    level: number,
    frameworkId: string,
  ): Promise<string> {
    const siblingsCount = await this.criteriaRepository.count({
      where: parentId ? { parentId, frameworkId } : { parentId: IsNull(), frameworkId },
    });

    const position = siblingsCount + 1;

    if (level === 1) {
      return this.toRoman(position);
    }

    if (!parentId) {
      throw new Error('Parent ID required for non-root criteria');
    }

    const parent = await this.criteriaRepository.findOne({
      where: { criteriaId: parentId },
    });

    if (!parent) {
      throw new Error('Parent criteria not found');
    }

    const parentCode = parent.criteriaCode;

    if (level === 2) {
      return `${parentCode}.${this.toLetter(position)}`;
    }

    return `${parentCode}.${position}`;
  }

  async create(createCriteriaDto: CreateCriteriaDto) {
    try {
      // Validate criteria frame exists and is in DRAFT status
      validateUUID(createCriteriaDto.frameworkId, 'frameworkId');
      const frame = await this.criteriaFrameRepository.findOne({
        where: { frameworkId: createCriteriaDto.frameworkId },
      });

      if (!frame) {
        throw new NotFoundException({
          EC: 0,
          EM: 'Criteria frame not found',
        });
      }

      if (frame.status !== FrameworkStatus.DRAFT) {
        throw new BadRequestException({
          EC: 0,
          EM: 'Cannot add criteria to a non-DRAFT frame',
        });
      }

      let parentCriteria: Criteria | null = null;
      let calculatedLevel = 1;

      if (createCriteriaDto.parentId) {
        validateUUID(createCriteriaDto.parentId, 'parentId');
        parentCriteria = await this.criteriaRepository.findOne({
          where: {
            criteriaId: createCriteriaDto.parentId,
            frameworkId: createCriteriaDto.frameworkId, // Ensure parent is in same framework
          },
        });

        if (!parentCriteria) {
          throw new NotFoundException({
            EC: 0,
            EM: 'Parent criteria not found in the same framework',
          });
        }

        calculatedLevel = (await this.calculateLevel(parentCriteria.criteriaId)) + 1;
      }

      const generatedCode = await this.generateCriteriaCode(
        createCriteriaDto.parentId || null,
        calculatedLevel,
        createCriteriaDto.frameworkId,
      );

      const siblingsCount = await this.criteriaRepository.count({
        where: createCriteriaDto.parentId
          ? { parentId: createCriteriaDto.parentId, frameworkId: createCriteriaDto.frameworkId }
          : { parentId: IsNull(), frameworkId: createCriteriaDto.frameworkId },
      });
      const displayOrder = siblingsCount + 1;

      let newCriteria_maxScore = createCriteriaDto.maxScore;

      const isRootCriteria = calculatedLevel === 1 && !createCriteriaDto.parentId;

      if (isRootCriteria && !newCriteria_maxScore) {
        throw new BadRequestException({
          EC: 0,
          EM: 'Root criteria must have maxScore',
        });
      }

      if (!isRootCriteria && !newCriteria_maxScore) {
        newCriteria_maxScore = null;
      }

      // Create new criteria
      const newCriteria = this.criteriaRepository.create({
        ...createCriteriaDto,
        criteriaCode: generatedCode,
        displayOrder: displayOrder,
        maxScore: newCriteria_maxScore,
      });

      const savedCriteria = await this.criteriaRepository.save(newCriteria);

      return {
        EC: 1,
        EM: 'Create criteria successfully',
        ...savedCriteria,
      };
    } catch (error) {
      console.error('Error creating criteria:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException({
        EC: 0,
        EM: 'An error occurred while creating criteria',
      });
    }
  }

  async findAll(query?: QueryCriteriaDto) {
    try {
      const whereCondition: any = {};

      // Filter by framework if provided
      if (query?.frameworkId) {
        validateUUID(query.frameworkId, 'frameworkId');
        whereCondition.frameworkId = query.frameworkId;
      }

      // Filter by framework status if provided
      if (query?.status) {
        whereCondition.framework = { status: query.status };
      }

      const criteria = await this.criteriaRepository.find({
        where: whereCondition,
        relations: ['parent', 'children', 'framework'],
        order: { displayOrder: 'ASC' },
      });

      // Calculate level and isLeaf for each criteria
      let detailCriteria = await Promise.all(
        criteria.map(async (c) => ({
          ...c,
          level: await this.calculateLevel(c.criteriaId),
          isLeaf: await this.isLeafCriteria(c.criteriaId),
        })),
      );

      // Sort by level first, then displayOrder
      detailCriteria.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.displayOrder - b.displayOrder;
      });

      // Filter by isLeaf if provided
      if (query?.isLeaf !== undefined) {
        detailCriteria = detailCriteria.filter((c) => c.isLeaf === query.isLeaf);
      }

      return {
        EC: 1,
        EM: 'Fetch all criteria successfully',
        criterias: detailCriteria,
      };
    } catch (error) {
      console.error('Error getting all criteria:');
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException({
        EC: 0,
        EM: 'An error occurred while getting all criteria',
      });
    }
  }

  async findOne(id: string) {
    try {
      validateUUID(id, 'criteriaId');
      const criteria = await this.criteriaRepository.findOne({
        where: { criteriaId: id },
        relations: ['parent', 'children'],
      });

      if (!criteria) {
        throw new NotFoundException({
          EC: 0,
          EM: 'Criteria not found',
        });
      }

      const level = await this.calculateLevel(criteria.criteriaId);
      const isLeaf = await this.isLeafCriteria(criteria.criteriaId);

      return {
        EC: 1,
        EM: 'Find one criteria successfully',
        ...criteria,
        level,
        isLeaf,
      };
    } catch (error) {
      console.error('Error finding criteria:', error.message);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException({
        EC: 0,
        EM: 'An error occurred while finding criteria',
      });
    }
  }

  async update(id: string, updateCriteriaDto: UpdateCriteriaDto) {
    try {
      validateUUID(id, 'criteriaId');
      const criteria = await this.criteriaRepository.findOne({
        where: { criteriaId: id },
        relations: ['children', 'framework'],
      });

      if (!criteria) {
        throw new NotFoundException({
          EC: 0,
          EM: 'Criteria not found',
        });
      }

      // Validate framework status is DRAFT
      if (criteria.framework.status !== FrameworkStatus.DRAFT) {
        throw new BadRequestException({
          EC: 0,
          EM: 'Cannot modify criteria in a non-DRAFT framework',
        });
      }

      if (updateCriteriaDto.parentId !== undefined) {
        throw new BadRequestException({
          EC: 0,
          EM: 'Cannot change parent of criteria. Please delete and create new one instead.',
        });
      }

      const currentLevel = await this.calculateLevel(criteria.criteriaId);
      const currentIsLeaf = await this.isLeafCriteria(criteria.criteriaId);

      const isRootCriteria = currentLevel === 1 && !criteria.parentId;

      if (updateCriteriaDto.maxScore !== undefined) {
        if (!isRootCriteria && !currentIsLeaf) {
          throw new BadRequestException({
            EC: 0,
            EM: 'Intermediate criteria (not root and has children) cannot have maxScore',
          });
        }

        if ((isRootCriteria || currentIsLeaf) && !updateCriteriaDto.maxScore) {
          throw new BadRequestException({
            EC: 0,
            EM: 'Root and leaf criteria must have maxScore',
          });
        }
      }

      // Chỉ cho phép update các trường: criteriaName, description, maxScore
      const allowedUpdates: Partial<Criteria> = {};
      if (updateCriteriaDto.criteriaName !== undefined) {
        allowedUpdates.criteriaName = updateCriteriaDto.criteriaName;
      }
      if (updateCriteriaDto.description !== undefined) {
        allowedUpdates.description = updateCriteriaDto.description;
      }
      if (updateCriteriaDto.maxScore !== undefined) {
        allowedUpdates.maxScore = updateCriteriaDto.maxScore;
      }

      await this.criteriaRepository.update({ criteriaId: id }, allowedUpdates);

      return {
        EC: 1,
        EM: 'Update criteria successfully',
        updated: {
          criteriaId: id,
        },
      };
    } catch (error) {
      console.error('Error updating criteria:', error.message);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException({
        EC: 0,
        EM: 'An error occurred while updating criteria',
      });
    }
  }

  //no transaction

  // async remove(id: string) {
  //   try {
  //     validateUUID(id, 'criteriaId');
  //     const criteria = await this.criteriaRepository.findOne({
  //       where: { criteriaId: id },
  //       relations: ['children', 'parent', 'framework'],
  //     });

  //     if (!criteria) {
  //       throw new NotFoundException({
  //         EC: 0,
  //         EM: 'Criteria not found',
  //       });
  //     }

  //     // Validate framework status is DRAFT
  //     if (criteria.framework.status !== FrameworkStatus.DRAFT) {
  //       throw new BadRequestException({
  //         EC: 0,
  //         EM: 'Cannot delete criteria from a non-DRAFT framework',
  //       });
  //     }

  //     // Lưu thông tin để regenerate code cho siblings
  //     const parentId = criteria.parentId;
  //     const level = await this.calculateLevel(criteria.criteriaId);
  //     const displayOrder = criteria.displayOrder;
  //     const frameworkId = criteria.frameworkId;

  //     // Đếm tổng số con cháu sẽ bị xóa
  //     const descendantsCount = await this.countAllDescendants(criteria.criteriaId);

  //     // Xóa tiêu chí này và tất cả con cháu
  //     await this.criteriaRepository.delete({ criteriaId: id });

  //     // Lấy tất cả siblings còn lại của tiêu chí bị xóa
  //     const affectedSiblings = await this.criteriaRepository.find({
  //       where: parentId ? { parentId, frameworkId } : { parentId: IsNull(), frameworkId },
  //       order: { displayOrder: 'ASC' },
  //     });
  //     console.log('affed siblings: ', affectedSiblings);

  //     // Cập nhật lại displayOrder và criteriaCode cho các siblings
  //     for (let i = 0; i < affectedSiblings.length; i++) {
  //       const sibling = affectedSiblings[i];
  //       // const newDisplayOrder = displayOrder + i;
  //       const newDisplayOrder = i + 1;

  //       // Regenerate code dựa trên position mới
  //       const newCode = await this.regenerateCriteriaCode(
  //         parentId,
  //         level,
  //         newDisplayOrder,
  //         frameworkId,
  //       );

  //       await this.criteriaRepository.update(
  //         { criteriaId: sibling.criteriaId },
  //         {
  //           displayOrder: newDisplayOrder,
  //           criteriaCode: newCode,
  //         },
  //       );

  //       // Cập nhật đệ quy cho tất cả con cháu của sibling này
  //       await this.updateDescendantsCodes(sibling.criteriaId, frameworkId);
  //     }

  //     return {
  //       EC: 1,
  //       EM: 'Delete criteria successfully',
  //       deleted: {
  //         criteriaId: id,
  //         totalDeleted: descendantsCount + 1,
  //         siblingsUpdated: affectedSiblings.length,
  //       },
  //     };
  //   } catch (error) {
  //     console.error('Error deleting criteria:', error.message);

  //     if (error instanceof HttpException) {
  //       throw error;
  //     }

  //     throw new InternalServerErrorException({
  //       EC: 0,
  //       EM: 'An error occurred while deleting criteria',
  //     });
  //   }
  // }

  //

  //use transaction
  async remove(id: string) {
    validateUUID(id, 'criteriaId');

    return await this.criteriaRepository.manager.transaction(async (transactionalEntityManager) => {
      try {
        const criteriaRepo = transactionalEntityManager.getRepository(Criteria);

        const criteria = await criteriaRepo.findOne({
          where: { criteriaId: id },
          relations: ['children', 'parent', 'framework'],
        });

        if (!criteria) {
          throw new NotFoundException({
            EC: 0,
            EM: 'Criteria not found',
          });
        }

        // Validate framework status is DRAFT
        if (criteria.framework.status !== FrameworkStatus.DRAFT) {
          throw new BadRequestException({
            EC: 0,
            EM: 'Cannot delete criteria from a non-DRAFT framework',
          });
        }

        // Lưu thông tin để regenerate code cho siblings
        const parentId = criteria.parentId;
        const level = await this.calculateLevel(criteria.criteriaId);
        const frameworkId = criteria.frameworkId;

        // Đếm tổng số con cháu sẽ bị xóa
        const descendantsCount = await this.countAllDescendants(criteria.criteriaId);

        // Xóa tiêu chí này và tất cả con cháu
        await criteriaRepo.delete({ criteriaId: id });

        // Lấy tất cả siblings còn lại của tiêu chí bị xóa
        const affectedSiblings = await criteriaRepo.find({
          where: parentId ? { parentId, frameworkId } : { parentId: IsNull(), frameworkId },
          order: { displayOrder: 'ASC' },
        });
        console.log('affected siblings: ', affectedSiblings);

        // BƯỚC 1: Set temp codes để tránh unique constraint violation
        for (const sibling of affectedSiblings) {
          await criteriaRepo.update(
            { criteriaId: sibling.criteriaId },
            { criteriaCode: `TEMP_${sibling.criteriaId}` },
          );
        }

        // BƯỚC 2: Cập nhật lại displayOrder và criteriaCode cho các siblings
        for (let i = 0; i < affectedSiblings.length; i++) {
          const sibling = affectedSiblings[i];
          const newDisplayOrder = i + 1;
          const newPosition = i + 1;

          // Regenerate code dựa trên position mới
          const newCode = await this.regenerateCriteriaCode(
            parentId,
            level,
            newPosition,
            criteriaRepo,
          );

          await criteriaRepo.update(
            { criteriaId: sibling.criteriaId },
            {
              displayOrder: newDisplayOrder,
              criteriaCode: newCode,
            },
          );

          // Cập nhật đệ quy cho tất cả con cháu của sibling này
          await this.updateDescendantsCodes(sibling.criteriaId, frameworkId, criteriaRepo);
        }

        return {
          EC: 1,
          EM: 'Delete criteria successfully',
          deleted: {
            criteriaId: id,
            totalDeleted: descendantsCount + 1,
            siblingsUpdated: affectedSiblings.length,
          },
        };
      } catch (error) {
        console.error('Error deleting criteria:', error.message);

        if (error instanceof HttpException) {
          throw error;
        }

        throw new InternalServerErrorException({
          EC: 0,
          EM: 'An error occurred while deleting criteria',
        });
      }
    });
  }

  /**
   * dùng trong transaction với repository được truyền vào
   */
  private async regenerateCriteriaCode(
    parentId: string | null,
    level: number,
    position: number,
    criteriaRepo: Repository<Criteria>,
  ): Promise<string> {
    // Level 1: I, II, III
    if (level === 1) {
      return this.toRoman(position);
    }

    if (!parentId) {
      throw new Error('Parent ID required for non-root criteria');
    }

    const parent = await criteriaRepo.findOne({
      where: { criteriaId: parentId },
    });

    if (!parent) {
      throw new Error('Parent criteria not found');
    }

    const parentCode = parent.criteriaCode;

    // Level 2: I.a, I.b, I.c
    if (level === 2) {
      return `${parentCode}.${this.toLetter(position)}`;
    }

    // Level 3+:  I.a.1, I.a.2 ....
    return `${parentCode}.${position}`;
  }

  /**
   * Cập nhật đệ quy criteriaCode cho tất cả con cháu của tiêu chí đó, dùng transaction
   */
  private async updateDescendantsCodes(
    parentId: string,
    frameworkId: string,
    criteriaRepo: Repository<Criteria>,
  ): Promise<void> {
    const children = await criteriaRepo.find({
      where: { parentId, frameworkId },
      order: { displayOrder: 'ASC' },
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childLevel = await this.calculateLevel(child.criteriaId);
      const newPosition = i + 1;

      // Regenerate code cho child
      const newCode = await this.regenerateCriteriaCode(
        parentId,
        childLevel,
        newPosition,
        criteriaRepo,
      );

      await criteriaRepo.update({ criteriaId: child.criteriaId }, { criteriaCode: newCode });

      // Đệ quy cập nhật cho các con của child này
      await this.updateDescendantsCodes(child.criteriaId, frameworkId, criteriaRepo);
    }
  }

  private async countAllDescendants(criteriaId: string): Promise<number> {
    const childrens = await this.criteriaRepository.find({
      where: { parentId: criteriaId },
    });

    if (childrens.length === 0) {
      return 0;
    }

    let count = childrens.length;
    for (const child of childrens) {
      count += await this.countAllDescendants(child.criteriaId);
    }

    return count;
  }

  async findTree(query?: QueryCriteriaDto) {
    try {
      const conditions: any = { parentId: IsNull() };

      // Filter by framework if provided
      if (query?.frameworkId) {
        validateUUID(query.frameworkId, 'frameworkId');
        conditions.frameworkId = query.frameworkId;
      }

      // Filter by framework status if provided
      if (query?.status) {
        conditions.framework = { status: query.status };
      }

      // Get all root criteria
      const rootCriteria = await this.criteriaRepository.find({
        where: conditions,
        order: { displayOrder: 'ASC' },
      });

      const tree = await Promise.all(rootCriteria.map((root) => this.buildCriteriaTree(root)));

      return {
        EC: 1,
        EM: 'Fetch criteria tree successfully',
        tree: tree,
      };
    } catch (error) {
      console.error('Error getting criteria tree:', error.message);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException({
        EC: 0,
        EM: 'An error occurred while getting criteria tree',
      });
    }
  }

  // private async calculateTotalScore(criteriaId: string): Promise<number> {
  //   const criteria = await this.criteriaRepository.findOne({
  //     where: { criteriaId },
  //     relations: ['children'],
  //   });

  //   if (!criteria) {
  //     return 0;
  //   }

  //   const isLeaf = await this.isLeafCriteria(criteriaId);

  //   // If it's a leaf node, return its maxScore
  //   if (isLeaf && criteria.maxScore !== null) {
  //     return criteria.maxScore;
  //   }

  //   // If it has children, sum their total scores
  //   if (criteria.children && criteria.children.length > 0) {
  //     const childrenScores = await Promise.all(
  //       criteria.children.map((child) => this.calculateTotalScore(child.criteriaId)),
  //     );
  //     return childrenScores.reduce((sum, score) => sum + score, 0);
  //   }

  //   // For intermediate nodes without children yet, return 0
  //   return 0;
  // }

  private async buildCriteriaTree(criteria: Criteria): Promise<any> {
    const children = await this.criteriaRepository.find({
      where: { parentId: criteria.criteriaId },
      order: { displayOrder: 'ASC' },
    });

    const childrenTree = await Promise.all(children.map((child) => this.buildCriteriaTree(child)));

    // Calculate dynamic properties
    const level = await this.calculateLevel(criteria.criteriaId);
    const isLeaf = await this.isLeafCriteria(criteria.criteriaId);
    // const totalScore = await this.calculateTotalScore(criteria.criteriaId);

    return {
      ...criteria,
      level,
      isLeaf,
      children: childrenTree,
      // totalScore,
    };
  }
}
