import { useState, useEffect, useCallback } from 'react';
import privateAxios from '@/lib/axios/privateAxios';
import { scoreApi } from '@/services/event-management.service';
import { calculateDrlRanking, IRankingResult } from '@/lib/drl-ranking';
import { ICriteria } from '@/types/criteria.type';

export interface IDrlCriterionRow {
  id: string;
  criteriaId: string;
  criteriaCode: string;
  criteriaName: string;
  parentId: string | null;
  level: number;
  displayOrder: number;
  maxPoints: number;
  approvedPoints: number;
  pendingPoints: number;
  totalProjectedPoints: number;
  isLeaf: boolean;
  children: IDrlCriterionRow[];
}

export interface IDrlCategoryProgress {
  criteriaId: string;
  criteriaCode: string;
  criteriaName: string;
  currentPoints: number;
  maxPoints: number;
  percentage: number;
}

export interface IDrlSummary {
  totalApproved: number;
  totalPending: number;
  ranking: IRankingResult;
}

interface RawScoreRecord {
  id: string;
  studentId: string;
  eventId: string;
  criteriaId: string;
  scoreValue: number;
  createdAt: string;
}

interface ScoreApiResponse {
  scores: RawScoreRecord[];
  totalsByCriteriaId: Record<string, number>;
}

export const useDrlAnalysisData = (studentId: string) => {
  const [criteriaRows, setCriteriaRows] = useState<IDrlCriterionRow[]>([]);
  const [categoryProgress, setCategoryProgress] = useState<IDrlCategoryProgress[]>([]);
  const [summary, setSummary] = useState<IDrlSummary>({
    totalApproved: 0,
    totalPending: 0,
    ranking: calculateDrlRanking(0),
  });

  const fetchData = useCallback(async () => {
    if (!studentId) return;

    try {
      const [treeRes, scoresRes] = await Promise.all([
        privateAxios.get(`/criterias/tree`, { params: { status: 'ACTIVE' } }),
        scoreApi.getByStudent(studentId),
      ]);

      const rawTree: ICriteria[] = treeRes.data?.tree ?? [];
      const scoreData: ScoreApiResponse = scoresRes.data ?? { scores: [], totalsByCriteriaId: {} };
      const approvedTotals: Record<string, number> = scoreData.totalsByCriteriaId ?? {};
      const rawScores: RawScoreRecord[] = scoreData.scores ?? [];

      const approvedEventIds = new Set<string>(rawScores.map((s) => s.eventId));
      const pendingMap: Record<string, number> = {};

      // Transform tree recursively
      const categoryProgressList: IDrlCategoryProgress[] = [];

      const transformNode = (
        node: ICriteria,
        level: number,
      ): IDrlCriterionRow => {
        const isLeaf = !node.children || node.children.length === 0;

        const childrenRows: IDrlCriterionRow[] = (node.children ?? [])
          .map((c) => transformNode(c, level + 1))
          .sort((a, b) => a.displayOrder - b.displayOrder);

        let maxP = node.maxScore != null ? Number(node.maxScore) : 0;
        if (!isLeaf && (maxP === 0 || isNaN(maxP))) {
          maxP = childrenRows.reduce((acc, c) => acc + c.maxPoints, 0);
        }

        let approvedP = 0;
        let pendingP = 0;

        if (isLeaf) {
          approvedP = approvedTotals[node.criteriaId] ?? 0;
        } else {
          approvedP = childrenRows.reduce(
            (acc, c) => acc + Math.min(c.approvedPoints, c.maxPoints || 100),
            0,
          );
          pendingP = childrenRows.reduce((acc, c) => acc + c.pendingPoints, 0);
        }

        if (maxP > 0) {
          approvedP = Math.min(approvedP, maxP);
        }

        const totalProjected = Math.min(
          approvedP + pendingP,
          maxP > 0 ? maxP : 999,
        );

        if (level === 0) {
          categoryProgressList.push({
            criteriaId: node.criteriaId,
            criteriaCode: node.criteriaCode,
            criteriaName: node.criteriaName,
            currentPoints: approvedP,
            maxPoints: maxP || 100,
            percentage: maxP > 0 ? (approvedP / maxP) * 100 : 0,
          });
        }

        return {
          id: node.criteriaId,
          criteriaId: node.criteriaId,
          criteriaCode: node.criteriaCode,
          criteriaName: node.criteriaName,
          parentId: node.parentId,
          level,
          displayOrder: node.displayOrder,
          maxPoints: maxP,
          approvedPoints: approvedP,
          pendingPoints: pendingP,
          totalProjectedPoints: totalProjected,
          isLeaf,
          children: childrenRows,
        };
      };

      const processedTree: IDrlCriterionRow[] = rawTree
        .map((node) => transformNode(node, 0))
        .sort((a, b) => a.displayOrder - b.displayOrder);

      const grandApproved = processedTree.reduce(
        (acc, c) => acc + c.approvedPoints,
        0,
      );
      const grandPending = processedTree.reduce(
        (acc, c) => acc + c.pendingPoints,
        0,
      );
      const cappedTotalApproved = Math.min(grandApproved, 100);

      setCriteriaRows(processedTree);
      setCategoryProgress(categoryProgressList);
      setSummary({
        totalApproved: cappedTotalApproved,
        totalPending: grandPending,
        ranking: calculateDrlRanking(cappedTotalApproved),
      });
    } catch (err) {
      console.error('Error loading DRL analysis data:', err);
    }
  }, [studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    criteriaRows,
    categoryProgress,
    summary,
    refresh: fetchData,
  };
};
