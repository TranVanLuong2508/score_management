'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  CheckCircle2,
  Clock,
  Award,
  TrendingUp,
  FilterX,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import {
  eventRegistrationService,
  IMyEventRegistration,
  REGISTRATION_STATUS,
  IMyEventsFilter,
} from '@/services/event-registration.service';
import { categoryService, IEventCategory } from '@/services/category.service';
import { criteriaService } from '@/services/criteria.service';
import {
  SemesterSelector,
  useAcademicCalendar,
} from '@/components/ui/semester-selector';
import { toast } from 'sonner';
import { Header } from '@/components/shared/header';
import { DatePicker } from '@/components/ui/date-picker';

interface CriteriaTreeNode {
  criteriaId: string;
  criteriaCode: string;
  criteriaName: string;
  maxScore: number | null;
  parentId: string | null;
  displayOrder: number;
  children: CriteriaTreeNode[];
}

interface ProcessedCriterion {
  criteriaId: string;
  criteriaCode: string;
  criteriaName: string;
  maxScore: number;
  approvedPoints: number;
  children: ProcessedCriterion[];
}

function processNode(
  node: CriteriaTreeNode,
  totals: Record<string, number>,
): ProcessedCriterion {
  const isLeaf = !node.children || node.children.length === 0;

  let maxP = node.maxScore !== null ? Number(node.maxScore) : 0;

  const childrenRows: ProcessedCriterion[] = isLeaf
    ? []
    : node.children
        .map((c) => processNode(c, totals))
        .sort((a, b) => a.maxScore - b.maxScore);

  if (!isLeaf && (maxP === 0 || isNaN(maxP))) {
    maxP = childrenRows.reduce((acc, curr) => acc + curr.maxScore, 0);
  }

  let approvedP = 0;
  if (isLeaf) {
    approvedP = totals[node.criteriaId] || 0;
  } else {
    approvedP = childrenRows.reduce(
      (acc, curr) => acc + Math.min(curr.approvedPoints, curr.maxScore || 100),
      0,
    );
  }

  if (maxP > 0) {
    approvedP = Math.min(approvedP, maxP);
  }

  return {
    criteriaId: node.criteriaId,
    criteriaCode: node.criteriaCode,
    criteriaName: node.criteriaName,
    maxScore: maxP || 100,
    approvedPoints: approvedP,
    children: childrenRows,
  };
}

export default function MyEventsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const [events, setEvents] = useState<IMyEventRegistration[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // semester filter
  const {
    academicYears,
    semesters,
    selectedAcademicYearId,
    selectedSemesterId,
    selectedAcademicYear,
    selectedSemester,
    setSelectedAcademicYearId,
    setSelectedSemesterId,
  } = useAcademicCalendar({ allowAllYears: true });

  // filter states
  const [timeFilter, setTimeFilter] = useState('ALL'); // ALL, TODAY, WEEK, MONTH, CUSTOM
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [categoryId, setCategoryId] = useState('ALL');
  const [criteriaId, setCriteriaId] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // dictionaries
  const [categories, setCategories] = useState<IEventCategory[]>([]);
  const [criteriaTree, setCriteriaTree] = useState<CriteriaTreeNode[]>([]);

  // Flatten criteriaTree để lấy leaf criteria cho dropdown
  const criteriaOptions = useMemo(() => {
    const collect: {
      criteriaId: string;
      criteriaCode?: string;
      criteriaName: string;
    }[] = [];
    const traverse = (nodes: CriteriaTreeNode[]) => {
      for (const node of nodes) {
        if (!node.children || node.children.length === 0) {
          collect.push({
            criteriaId: node.criteriaId,
            criteriaCode: node.criteriaCode,
            criteriaName: node.criteriaName,
          });
        }
        if (node.children?.length) traverse(node.children);
      }
    };
    if (criteriaTree.length) traverse(criteriaTree);
    return collect;
  }, [criteriaTree]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const fetchDicts = async () => {
      try {
        const [catRes, treeRes] = await Promise.all([
          categoryService.getAllCategories(),
          criteriaService.getActiveCriteriaTree(),
        ]);
        if (catRes.EC === 1 && catRes.data?.categories) {
          setCategories(catRes.data.categories);
        }
        if (treeRes.EC === 1 && treeRes.data?.tree) {
          setCriteriaTree(treeRes.data.tree);
        }
      } catch (error) {
        console.error('Fetch dicts error', error);
      }
    };
    fetchDicts();
  }, []);

  const fetchEvents = async () => {
    if (!isAuthenticated) return;
    try {
      setIsFetching(true);
      const filter: IMyEventsFilter = {};
      if (categoryId !== 'ALL') filter.categoryIds = categoryId;
      if (criteriaId !== 'ALL') filter.criteriaIds = criteriaId;
      if (statusFilter !== 'ALL')
        filter.status = statusFilter as REGISTRATION_STATUS;

      // Handle dates
      let start: Date | undefined, end: Date | undefined;
      if (timeFilter !== 'ALL') {
        const now = new Date();
        if (timeFilter === 'TODAY') {
          start = new Date(now.setHours(0, 0, 0, 0));
          end = new Date(now.setHours(23, 59, 59, 999));
        } else if (timeFilter === 'WEEK') {
          const first = now.getDate() - now.getDay() + 1; // Mon
          start = new Date(now.setDate(first));
          start.setHours(0, 0, 0, 0);
          end = new Date(now.setDate(first + 6));
          end.setHours(23, 59, 59, 999);
        } else if (timeFilter === 'MONTH') {
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          end.setHours(23, 59, 59, 999);
        } else if (timeFilter === 'CUSTOM') {
          if (customStartDate) start = new Date(customStartDate);
          if (customEndDate) {
            end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
          }
        }
      } else {
        // Use SemesterSelector
        if (selectedSemesterId === 'all') {
          if (
            selectedAcademicYearId !== 'all' &&
            selectedAcademicYear?.startDate &&
            selectedAcademicYear?.endDate
          ) {
            start = new Date(selectedAcademicYear.startDate);
            end = new Date(selectedAcademicYear.endDate);
            end.setHours(23, 59, 59, 999);
          }
        } else if (selectedSemester?.startDate && selectedSemester?.endDate) {
          start = new Date(selectedSemester.startDate);
          end = new Date(selectedSemester.endDate);
          end.setHours(23, 59, 59, 999);
        }
      }

      if (start) filter.startDate = start.toISOString();
      if (end) filter.endDate = end.toISOString();

      const res = await eventRegistrationService.getMyEvents(filter);
      if (res.EC === 1 && res.data?.registrations) {
        setEvents(res.data.registrations);
      }
    } catch (error) {
      console.error('Failed to fetch my events', error);
      toast.error('Không thể lấy danh sách sự kiện');
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    // debounce fetch if custom dates change
    const timeoutId = setTimeout(() => {
      fetchEvents();
    }, 300);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    timeFilter,
    customStartDate,
    customEndDate,
    categoryId,
    criteriaId,
    statusFilter,
    selectedSemesterId,
    selectedAcademicYearId,
  ]);

  if (!isAuthenticated) return null;

  const handleCancelRegistration = async (eventId: string) => {
    setCancellingId(eventId);
    try {
      const res = await eventRegistrationService.cancelMyRegistration(eventId);
      if (res && (res.EC === 1 || res.statusCode === '200')) {
        toast.success(res.message || 'Hủy đăng ký thành công!');
        fetchEvents();
      } else {
        toast.error(res?.message || 'Hủy đăng ký thất bại!');
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.EM ||
        error?.response?.data?.message ||
        'Đã xảy ra lỗi khi hủy đăng ký!';
      toast.error(msg);
    } finally {
      setCancellingId(null);
    }
  };

  // Build totals: mỗi leaf criteria = tổng score sự kiện đã tham gia, capped tại maxScore
  const totalsByCriteriaId = useMemo(() => {
    const totals: Record<string, number> = {};

    for (const reg of events) {
      if (reg.status !== REGISTRATION_STATUS.ATTENDED) continue;
      const criteriaId = reg.event.criteria?.criteriaId;
      if (!criteriaId) continue;

      const maxScore = reg.event.criteria?.maxScore ?? null;
      const score = reg.event.score || 0;

      const current = totals[criteriaId] || 0;
      const next = current + score;

      // Cap tại maxScore của tiêu chí lá (maxScore null = không giới hạn)
      if (maxScore !== null) {
        totals[criteriaId] = Math.min(next, maxScore);
      } else {
        totals[criteriaId] = next;
      }
    }

    return totals;
  }, [events]);

  // Xử lý cây tiêu chí: đệ quy tính điểm parent = tổng con, capped tại maxScore
  const criteriaScores = useMemo(() => {
    if (!criteriaTree.length) return { roots: [], total: 0 };

    const processed = criteriaTree
      .map((node) => processNode(node, totalsByCriteriaId))
      .sort((a, b) => a.maxScore - b.maxScore);

    // Total points = tổng approvedPoints của root, capped ở 100
    const total = processed.reduce((acc, c) => acc + c.approvedPoints, 0);
    return { roots: processed, total };
  }, [criteriaTree, totalsByCriteriaId]);

  // Derived stats (giữ lại các stat khác)
  const totalEventsAttended = events.filter(
    (e) => e.status === REGISTRATION_STATUS.ATTENDED,
  ).length;
  const totalUpcoming = events.filter(
    (e) => e.status === REGISTRATION_STATUS.REGISTERED,
  ).length;

  const resetFilters = () => {
    setTimeFilter('ALL');
    setCustomStartDate('');
    setCustomEndDate('');
    setCategoryId('ALL');
    setCriteriaId('ALL');
    setStatusFilter('ALL');
  };

  const renderStatusBadge = (status: REGISTRATION_STATUS) => {
    switch (status) {
      case REGISTRATION_STATUS.REGISTERED:
        return (
          <Badge className="bg-primary hover:bg-primary/90">Sắp diễn ra</Badge>
        );
      case REGISTRATION_STATUS.ATTENDED:
        return (
          <Badge className="bg-green-500 hover:bg-green-600">Đã tham gia</Badge>
        );
      case REGISTRATION_STATUS.ABSENT:
        return <Badge variant="secondary">Vắng mặt</Badge>;
      case REGISTRATION_STATUS.CANCELLED:
        return <Badge variant="destructive">Đã hủy</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-col items-center md:flex-row md:justify-center relative mb-8 gap-4 px-0">
          <Button
            variant="ghost"
            onClick={() => router.push('/dashboard')}
            className="absolute left-0 top-0 md:top-1/2 md:-translate-y-1/2 w-fit -ml-2 md:ml-0"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Quay lại
          </Button>
          <div className="text-center mt-8 md:mt-0 px-8 sm:px-0">
            <h1 className="text-2xl md:text-3xl font-bold">Sự kiện của tôi</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Quản lý các sự kiện bạn đã tham gia hoặc đăng ký
            </p>
          </div>
        </div>
        {/* Semester Selector */}
        <div className="mb-6">
          <SemesterSelector
            selectedSemesterId={selectedSemesterId}
            selectedAcademicYearId={selectedAcademicYearId}
            academicYears={academicYears}
            semesters={semesters}
            onSemesterChange={setSelectedSemesterId}
            onAcademicYearChange={setSelectedAcademicYearId}
            showAllYearOption={true}
            showAllOption={true}
          />
        </div>

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card className="hover:shadow-md hover:-translate-y-px transition-all duration-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Đã tham gia
                  </p>
                  <p className="text-3xl font-bold">{totalEventsAttended}</p>
                </div>
                <div className="p-3 rounded-xl bg-green-500/10">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md hover:-translate-y-px transition-all duration-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Điểm đã tích lũy (DK)
                  </p>
                  <p className="text-3xl font-bold text-primary">
                    {criteriaScores.total}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-yellow-500/10">
                  <Award className="w-6 h-6 text-yellow-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md hover:-translate-y-px transition-all duration-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Sắp tới</p>
                  <p className="text-3xl font-bold">{totalUpcoming}</p>
                </div>
                <div className="p-3 rounded-xl bg-primary/10">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6 bg-muted/30">
          <CardContent className="p-4 grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-5 items-end">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Thời gian
              </label>
              <Select value={timeFilter} onValueChange={setTimeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn thời gian" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả thời gian</SelectItem>
                  <SelectItem value="TODAY">Hôm nay</SelectItem>
                  <SelectItem value="WEEK">Tuần này</SelectItem>
                  <SelectItem value="MONTH">Tháng này</SelectItem>
                  <SelectItem value="CUSTOM">Tùy chọn...</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {timeFilter === 'CUSTOM' && (
              <div className="col-span-1 md:col-span-2 flex items-center gap-2">
                <DatePicker
                  label="Từ ngày"
                  value={customStartDate}
                  onChange={setCustomStartDate}
                  placeholder="Chọn ngày bắt đầu"
                />
                <DatePicker
                  label="Đến ngày"
                  value={customEndDate}
                  onChange={setCustomEndDate}
                  placeholder="Chọn ngày kết thúc"
                  minDate={
                    customStartDate ? new Date(customStartDate) : undefined
                  }
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Danh mục
              </label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả danh mục</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.categoryId} value={c.categoryId}>
                      {c.categoryName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Tiêu chí
              </label>
              <Select value={criteriaId} onValueChange={setCriteriaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn tiêu chí" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả tiêu chí</SelectItem>
                  {criteriaOptions.map((c) => (
                    <SelectItem key={c.criteriaId} value={c.criteriaId}>
                      {c.criteriaCode
                        ? `${c.criteriaCode} ${c.criteriaName}`
                        : c.criteriaName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Trạng thái
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
                  <SelectItem value={REGISTRATION_STATUS.REGISTERED}>
                    Đã đăng ký (Sắp tới)
                  </SelectItem>
                  <SelectItem value={REGISTRATION_STATUS.ATTENDED}>
                    Đã tham gia
                  </SelectItem>
                  <SelectItem value={REGISTRATION_STATUS.ABSENT}>
                    Vắng mặt
                  </SelectItem>
                  <SelectItem value={REGISTRATION_STATUS.CANCELLED}>
                    Đã hủy
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={resetFilters}
              >
                <FilterX className="w-4 h-4 mr-2" /> Xóa lọc
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Event List */}
        <div className="grid gap-4">
          {isFetching ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-xl border border-border/40 shadow-sm">
              <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">
                Không tìm thấy sự kiện nào
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Hãy thử thay đổi điều kiện lọc.
              </p>
            </div>
          ) : (
            events.map((reg) => {
              const event = reg.event;
              const dateObj = new Date(event.startDate);
              const formattedDate = dateObj.toLocaleDateString('vi-VN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              });
              const formattedTime = dateObj.toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              });

              // Check status
              const isAttended = reg.status === REGISTRATION_STATUS.ATTENDED;

              return (
                <Card
                  key={reg.id}
                  className="hover:shadow-md hover:-translate-y-px transition-all duration-200 overflow-hidden"
                >
                  <CardContent className="p-6 flex-1">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {renderStatusBadge(reg.status)}
                          {event.categories?.map((c) => (
                            <Badge
                              key={c.categoryId}
                              variant="outline"
                              className="text-xs"
                            >
                              {c.categoryName}
                            </Badge>
                          ))}
                        </div>
                        <h3 className="text-lg font-bold mb-2 line-clamp-2">
                          {event.eventName}
                        </h3>
                        <div className="space-y-1 text-sm text-muted-foreground mt-4">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            <span>{formattedDate}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            <span>{formattedTime}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span className="line-clamp-1">
                              {event.location || 'Chưa cập nhật'}
                            </span>
                          </div>
                          {event.criteria && (
                            <div className="pt-1">
                              <Badge
                                variant="outline"
                                className="text-xs font-medium border-primary/30 bg-primary/5 text-primary py-0.5"
                              >
                                <Award className="w-3 h-3 mr-1" />
                                Cộng vào{' '}
                                {event.criteria.criteriaCode
                                  ? `${event.criteria.criteriaCode} `
                                  : ''}
                                {event.criteria.criteriaName}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-between min-h-full gap-4">
                        <div className="text-right">
                          {isAttended ? (
                            <Badge className="bg-green-500 hover:bg-green-600 px-3 py-1 text-sm rounded-full">
                              +{event.score || 0} điểm
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="px-3 py-1 text-sm rounded-full"
                            >
                              {event.score || 0} điểm (Dự kiến)
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              router.push(`/events/${event.eventId}`)
                            }
                          >
                            Xem chi tiết
                          </Button>
                          {reg.status === REGISTRATION_STATUS.REGISTERED && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={cancellingId === event.eventId}
                                >
                                  {cancellingId === event.eventId
                                    ? 'Đang hủy...'
                                    : 'Hủy đăng ký'}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Xác nhận hủy đăng ký
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Bạn có chắc muốn hủy đăng ký sự kiện &quot;
                                    {event.eventName}&quot; không?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    Quay lại
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() =>
                                      handleCancelRegistration(event.eventId)
                                    }
                                  >
                                    Xác nhận hủy
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
