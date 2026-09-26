'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { attendanceApi, eventMgmtApi, IEventAttendance } from '@/services/event-management.service';
import { AttendanceList } from '../_components/AttendanceList';
import AdminHeader from '@/components/admin/layout/AdminHeader';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export default function OrganizerAttendancesPage() {
    const { authUser } = useAuthStore();
    const createdByFilter = authUser?.userId ? String(authUser.userId) : undefined;

    const [attendances, setAttendances] = useState<IEventAttendance[]>([]);
    const [loading, setLoading] = useState(true);
    const myEventIdsRef = useRef<Set<string>>(new Set());
    const hasFetched = useRef(false);

    const loadAttendances = useCallback(async () => {
        setLoading(true);
        try {
            // Nếu chưa có danh sách eventId của organizer, fetch trước
            if (myEventIdsRef.current.size === 0 && createdByFilter) {
                const evRes = await eventMgmtApi.getAll({ createdBy: createdByFilter });
                myEventIdsRef.current = new Set(
                    (evRes.data?.events ?? []).map((e) => e.eventId),
                );
            }

            const res = await attendanceApi.getAll();
            const all = res.data?.attendances ?? [];

            // Chỉ hiện attendance thuộc sự kiện của organizer
            const myEventIds = myEventIdsRef.current;
            setAttendances(
                myEventIds.size > 0
                    ? all.filter((a) => myEventIds.has(a.eventId))
                    : all,
            );
        } catch {
            toast.error('Không thể tải danh sách điểm danh');
        } finally {
            setLoading(false);
        }
    }, [createdByFilter]);

    useEffect(() => {
        if (!hasFetched.current) {
            hasFetched.current = true;
            loadAttendances();
        }
    }, [loadAttendances]);

    return (
        <div className="flex flex-col h-full w-full">
            <AdminHeader />

            <main className="flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">Đang tải...</span>
                    </div>
                ) : (
                    <AttendanceList
                        attendances={attendances}
                        loading={false}
                        onRefresh={loadAttendances}
                        onToast={(ok, msg) => ok ? toast.success(msg) : toast.error(msg)}
                    />
                )}
            </main>
        </div>
    );
}
