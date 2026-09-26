'use client';

import { useState } from 'react';
import { scoreApi, IStudentScore } from '@/services/event-management.service';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/utils/formateDate';
import { Input } from '@/components/ui/input';

interface Props {
  onToast: (ok: boolean, msg: string) => void;
}

export function StudentScorePanel({ onToast }: Props) {
  const [studentId, setStudentId] = useState('');
  const [scores, setScores] = useState<IStudentScore[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await scoreApi.getByStudent(studentId.trim());
      setScores(res.data?.scores ?? []);
      setTotals(res.data?.totalsByCriteriaId ?? {});
    } catch {
      onToast(false, 'Không thể lấy điểm sinh viên');
      setScores([]);
    } finally {
      setLoading(false);
    }
  };

  const totalScore = Object.values(totals).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      {/* Search form */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
        <Input
          placeholder="Nhập Student ID (UUID)..."
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? 'Đang tìm...' : 'Tìm kiếm'}
        </Button>
      </form>

      {/* Results */}
      {!searched && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Nhập Student ID để xem điểm rèn luyện
        </div>
      )}

      {searched && scores.length === 0 && !loading && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Không có dữ liệu điểm cho sinh viên này
        </div>
      )}

      {scores.length > 0 && (
        <>
          {/* Summary card */}
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Tổng điểm</p>
              <p className="text-2xl font-bold mt-1">{totalScore}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Số lượt cộng</p>
              <p className="text-2xl font-bold mt-1">{scores.length}</p>
            </div>
          </div>

          {/* Score table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Sự kiện</th>
                  <th className="text-left px-4 py-3 font-medium">
                    Criteria ID
                  </th>
                  <th className="text-left px-4 py-3 font-medium">
                    Điểm được cộng
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {scores.map((sc) => (
                  <tr
                    key={sc.id}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      {sc.event?.eventName ?? sc.eventId.slice(0, 8) + '...'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {sc.criteriaId.slice(0, 12)}...
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-600">
                      +{sc.scoreValue}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(sc.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tổng điểm theo criteria */}
          {Object.keys(totals).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Tổng điểm theo tiêu chí
              </h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals).map(([criteriaId, total]) => (
                  <div
                    key={criteriaId}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-muted-foreground">
                      {criteriaId.slice(0, 8)}...
                    </span>
                    <span className="ml-2 font-bold text-green-600">
                      {total} điểm
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
