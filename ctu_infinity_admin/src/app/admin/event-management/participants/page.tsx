'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { eventMgmtApi, IEvent } from '@/services/event-management.service';
import { EventParticipantsPanel } from '../_components/EventParticipantsPanel';
import AdminHeader from '@/components/admin/layout/AdminHeader';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export default function OrganizerParticipantsPage() {
    const { authUser } = useAuthStore();
    const createdByFilter = authUser?.userId ? String(authUser.userId) : undefined;

    const [events, setEvents] = useState<IEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const hasFetched = useRef(false);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        try {
            const res = await eventMgmtApi.getAll({ createdBy: createdByFilter });
            setEvents(res.data?.events ?? []);
        } catch {
            toast.error('Không thể tải danh sách sự kiện');
        } finally {
            setLoading(false);
        }
    }, [createdByFilter]);

    useEffect(() => {
        if (!hasFetched.current) {
            hasFetched.current = true;
            loadEvents();
        }
    }, [loadEvents]);

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
                    <EventParticipantsPanel
                        events={events}
                        organizers={[]}
                        isAdmin={false}
                        onToast={(ok, message) =>
                            ok ? toast.success(message) : toast.error(message)
                        }
                    />
                )}
            </main>
        </div>
    );
}
