'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BookOpen,
  Users,
  Trophy,
  Heart,
  Briefcase,
  Calendar,
  AlertCircle,
  ArrowRight,
  LogOut,
  CheckCircle2,
  MapPin,
  Search,
  Clock,
  Eye,
  QrCode,
  Bell,
  FilterX,
} from 'lucide-react';
import { DRLChart } from '@/components/drl-chart';
import { SuggestionCard } from '@/components/suggestion-card';
import {
  SemesterSelector,
  useAcademicCalendar,
} from '@/components/ui/semester-selector';
import { TabSwitcher, type TabType } from '@/components/ui/tab-switcher';
import { RegisterEventModal } from '@/components/ui/register-event-modal';
// import { SubscriptionSettingsModal } from '@/components/dashboard/subscription-settings-modal';
import { useAuthStore } from '@/stores/authStore';
import { useEventStore } from '@/stores/eventStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { authService } from '@/services/auth.service';
import { categoryService, IEventCategory } from '@/services/category.service';
import { REGISTRATION_STATUS } from '@/services/event-registration.service';
import { useAppRouter } from '@/hooks/useAppRouter';
import { toast } from 'sonner';
import { AUTH_MESSAGES } from '@/constants/messages/authMessage';
import { Header } from '@/components/shared/header';
import { CriteriaCard } from '@/components/dashboard/criteria-card';
import { DatePicker } from '@/components/ui/date-picker';
export { UserDropdown } from '@/components/shared/user-dropdown';

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('drl');
  const [searchQuery, setSearchQuery] = useState('');

  const [timeFilter, setTimeFilter] = useState('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [categoryId, setCategoryId] = useState('ALL');
  const [criteriaId, setCriteriaId] = useState('ALL');
  const [categories, setCategories] = useState<IEventCategory[]>([]);

  // Bộ lọc cho section gợi ý
  const [reasonFilter, setReasonFilter] = useState('ALL');

  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    academicYears,
    semesters,
    selectedAcademicYearId,
    selectedSemesterId,
    selectedAcademicYear,
    selectedSemester,
    setSelectedAcademicYearId,
    setSelectedSemesterId,
  } = useAcademicCalendar();

  const { authUser, isAuthenticated, isLoading, logOutAction } = useAuthStore();
  const { goLogin } = useAppRouter();
  const { registerEvent, isRegistering, fetchEvents } = useEventStore();

  // Nạp Dashboard State
  const {
    fetchDashboardData,
    refreshRegistrationStatuses,
    criteriaTree,
    isLoading: isDashboardLoading,
  } = useDashboardStore();
  const stats = useDashboardStats();

  // Flatten criteriaTree để lấy all criteria (chỉ lá) cho bộ lọc dropdown
  const criteriaOptions = useMemo(() => {
    const collect: {
      criteriaId: string;
      criteriaCode?: string;
      criteriaName: string;
    }[] = [];
    const traverse = (nodes: typeof criteriaTree) => {
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

  // Fetch dữ liệu tập trung 1 lần
  useEffect(() => {
    if (!isAuthenticated) return;

    if (selectedSemesterId && selectedSemesterId !== 'all') {
      fetchDashboardData({ semesterId: selectedSemesterId });
    }

    categoryService
      .getAllCategories()
      .then((res) => {
        if (res.EC === 1 && res.data?.categories)
          setCategories(res.data.categories);
      })
      .catch(console.error);
  }, [
    isAuthenticated,
    fetchDashboardData,
    selectedAcademicYearId,
    selectedSemesterId,
  ]);

  const handleLogout = async () => {
    try {
      // Gọi API logout
      await authService.callLogout();
      toast.success(AUTH_MESSAGES.logoutSucess);
    } catch (error) {
      console.log('Logout error:', error);
      toast.error(AUTH_MESSAGES.errorLogout);
    } finally {
      logOutAction();
      goLogin();
    }
  };

  // Events filtering logic cho tab Sự kiện
  const filteredEvents = stats.allMappedEvents.filter((event) => {
    const matchesSearch = event.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryId === 'ALL' ||
      (event.fullObj?.categories &&
        event.fullObj.categories.some((c: any) => c.categoryId === categoryId));
    const matchesCriteria =
      criteriaId === 'ALL' || event.criteriaId === criteriaId;

    let matchesTime = true;
    if (timeFilter !== 'ALL') {
      const eventDate = new Date(event.date);
      const now = new Date();
      if (timeFilter === 'TODAY') {
        matchesTime = eventDate.toDateString() === now.toDateString();
      } else if (timeFilter === 'WEEK') {
        const first = now.getDate() - now.getDay() + 1;
        const start = new Date(now.setDate(first));
        start.setHours(0, 0, 0, 0);
        const end = new Date(now.setDate(first + 6));
        end.setHours(23, 59, 59, 999);
        matchesTime = eventDate >= start && eventDate <= end;
      } else if (timeFilter === 'MONTH') {
        matchesTime =
          eventDate.getMonth() === now.getMonth() &&
          eventDate.getFullYear() === now.getFullYear();
      } else if (timeFilter === 'CUSTOM') {
        if (customStartDate)
          matchesTime = matchesTime && eventDate >= new Date(customStartDate);
        if (customEndDate) {
          const endD = new Date(customEndDate);
          endD.setHours(23, 59, 59, 999);
          matchesTime = matchesTime && eventDate <= endD;
        }
      }
    }

    return matchesSearch && matchesCategory && matchesCriteria && matchesTime;
  });

  // Lọc gợi ý theo lý do
  const filteredRecommendedEvents = stats.recommendedEvents.filter((event) => {
    if (reasonFilter === 'ALL') return true;
    return event.explanation?.reasonType === reasonFilter;
  });

  const handleRegisterClick = (event: (typeof filteredEvents)[0]) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const handleRegisterConfirm = async () => {
    if (!selectedEvent) return;

    const success = await registerEvent(selectedEvent.id.toString());
    if (success) {
      setIsModalOpen(false);
      // Refresh trạng thái đăng ký trên các card sự kiện
      refreshRegistrationStatuses();
    }
  };
  // // Show loading khi đang kiểm tra authentication (reload/F5)
  //     if (isLoading) {
  //         return <Loading />
  //     }

  // Không authenticated -> sẽ redirect trong useEffect

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Tab Switcher */}
        <div className="mb-6 flex justify-center">
          <TabSwitcher activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* DRL Content */}
        {activeTab === 'drl' && (
          <>
            {/* Semester Selector */}
            <div className="mb-6">
              <SemesterSelector
                selectedSemesterId={selectedSemesterId}
                selectedAcademicYearId={selectedAcademicYearId}
                academicYears={academicYears}
                semesters={semesters}
                onSemesterChange={setSelectedSemesterId}
                onAcademicYearChange={setSelectedAcademicYearId}
                showAllOption={false}
              />
            </div>

            {/* Overview Section */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
              <Card className="col-span-full lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-2xl">
                    Tổng điểm rèn luyện
                  </CardTitle>
                  <CardDescription>
                    {selectedSemesterId === 'all'
                      ? 'Tất cả học kỳ'
                      : selectedSemester?.semesterName || 'Học kỳ'}{' '}
                    - Năm học {selectedAcademicYear?.yearName || 'N/A'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-end gap-2">
                      <span className="text-5xl font-bold text-primary">
                        {stats.totalPoints}
                      </span>
                      <span className="text-2xl text-muted-foreground mb-1">
                        / {stats.maxTotalPoints}
                      </span>
                    </div>
                    <Progress value={stats.percentage} className="h-3" />
                    <p className="text-sm text-muted-foreground">
                      Hoàn thành {stats.percentage.toFixed(1)}% - Còn thiếu{' '}
                      {stats.maxTotalPoints - stats.totalPoints} điểm
                    </p>
                    <Button
                      variant="outline"
                      className="w-full mt-2"
                      onClick={() => router.push('/drl-analysis')}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Xem chi tiết tiêu chí
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Xếp loại dự kiến
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Badge
                      className={`text-lg px-3 py-1 ${stats.currentRanking.color} text-white`}
                    >
                      {stats.currentRanking.label}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {stats.currentRanking.nextStep}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Điểm theo học kỳ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">HK1</span>
                      <span className="font-bold">--/100</span>
                    </div>
                    <Progress value={0} className="h-2" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-primary">HK hiện tại</span>
                      <span className="font-bold text-primary">
                        {stats.totalPoints}/100
                      </span>
                    </div>
                    <Progress value={stats.percentage} className="h-2" />
                    <div className="pt-2 border-t">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">
                          Trung bình cả năm (dự kiến)
                        </span>
                        <span className="font-bold">
                          {Math.round(stats.totalPoints / 2)}/100
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts Section */}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              <Card>
                <CardHeader>
                  <CardTitle>Biểu đồ phân bổ điểm</CardTitle>
                  <CardDescription>
                    Điểm số theo từng tiêu chí đánh giá
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DRLChart data={stats.criteriaData} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-500" />
                    Phân tích thiếu điểm
                  </CardTitle>
                  <CardDescription>
                    Các tiêu chí bạn cần cải thiện
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {stats.lackingCriterias.length > 0 ? (
                      stats.lackingCriterias.slice(0, 3).map((criteria) => {
                        const Icon = criteria.icon;
                        return (
                          <div key={criteria.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Icon className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm font-medium line-clamp-1">
                                  {criteria.name}
                                </span>
                              </div>
                              <Badge variant="secondary" className="text-xs">
                                Thiếu {criteria.lacking} điểm
                              </Badge>
                            </div>
                            <Progress
                              value={criteria.percentComplete}
                              className="h-2"
                            />
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Bạn đã đạt tối đa điểm ở mọi tiêu chí!
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Criteria Details */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Chi tiết theo tiêu chí</CardTitle>
                <CardDescription>
                  Tiêu chí đánh giá điểm rèn luyện
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats.criteriaData.map((criteria) => {
                    const Icon = criteria.icon;
                    const percent = criteria.percentComplete;

                    return (
                      <CriteriaCard
                        key={criteria.id}
                        criteria={criteria}
                        icon={Icon}
                        events={stats.eventsByCriteria[criteria.id] || []}
                      />
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Suggestions Section */}
            <Card>
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">
                  Gợi ý cá nhân hóa sự kiện cho bạn
                </CardTitle>
                <CardDescription>
                  Các sự kiện sắp diễn ra giúp bạn bổ sung điểm
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Bộ lọc lý do gợi ý */}
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    size="sm"
                    variant={reasonFilter === 'ALL' ? 'default' : 'outline'}
                    onClick={() => setReasonFilter('ALL')}
                    className="text-xs"
                  >
                    Tất cả
                  </Button>
                  <Button
                    size="sm"
                    variant={reasonFilter === 'DEFICIT' ? 'default' : 'outline'}
                    onClick={() => setReasonFilter('DEFICIT')}
                    className="text-xs"
                  >
                    Bù điểm thiếu
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      reasonFilter === 'SUBSCRIPTION' ? 'default' : 'outline'
                    }
                    onClick={() => setReasonFilter('SUBSCRIPTION')}
                    className="text-xs"
                  >
                    Theo sở thích
                  </Button>
                  <Button
                    size="sm"
                    variant={reasonFilter === 'HISTORY' ? 'default' : 'outline'}
                    onClick={() => setReasonFilter('HISTORY')}
                    className="text-xs"
                  >
                    Tương tự sự kiện cũ
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      reasonFilter === 'COMMUNITY' ? 'default' : 'outline'
                    }
                    onClick={() => setReasonFilter('COMMUNITY')}
                    className="text-xs"
                  >
                    Cộng đồng quan tâm
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredRecommendedEvents.map((event) => (
                    <div key={event.id}>
                      <SuggestionCard
                        event={{
                          ...event,
                          criteriaId: String(event.criteriaId),
                        }}
                        criteria={{
                          ...(event.criteriaObj || {}),
                          id: (event.criteriaObj?.id ?? event.criteriaId) as
                            | string
                            | number,
                          name:
                            event.criteriaObj?.name ??
                            event.criteriaName ??
                            'Chưa phân loại',
                        }}
                        onViewDetails={(eventId) =>
                          router.push(`/events/${eventId}`)
                        }
                        explanation={event.explanation || null}
                      />
                    </div>
                  ))}
                </div>
                {filteredRecommendedEvents.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    {reasonFilter === 'ALL'
                      ? 'Chưa có sự kiện nào sắp tới để gợi ý cho bạn'
                      : 'Không có sự kiện nào phù hợp với bộ lọc này'}
                  </p>
                )}

                <div className="mt-6 text-center">
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab('events')}
                  >
                    Xem tất cả sự kiện
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Events Content */}
        {activeTab === 'events' && (
          <>
            {/* Search and Filter */}
            <Card className="mb-6 bg-muted/30">
              <CardContent className="p-4 space-y-4">
                <div className="flex gap-4 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Tìm kiếm sự kiện..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-5 items-end">
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
                          customStartDate
                            ? new Date(customStartDate)
                            : undefined
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
                  <div>
                    <Button
                      variant="ghost"
                      className="w-full text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setTimeFilter('ALL');
                        setCustomStartDate('');
                        setCustomEndDate('');
                        setCategoryId('ALL');
                        setCriteriaId('ALL');
                        setSearchQuery('');
                      }}
                    >
                      <FilterX className="w-4 h-4 mr-2" /> Xóa lọc
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Events List */}
            <div className="grid gap-6 md:grid-cols-2">
              {filteredEvents.map((event) => {
                const dateObj = new Date(event.date);
                const formattedDate = dateObj.toLocaleDateString('vi-VN', {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                });
                const participantPercent =
                  event.participants != null &&
                  event.maxParticipants != null &&
                  event.maxParticipants > 0
                    ? (event.participants / event.maxParticipants) * 100
                    : 0;

                return (
                  <Card
                    key={event.id}
                    className="hover:shadow-md hover:-translate-y-px transition-all duration-200"
                  >
                    <CardHeader>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between items-start gap-2 mb-2">
                        <Badge
                          variant="outline"
                          className="text-xs whitespace-normal h-auto text-left wrap-break-word max-w-full"
                        >
                          {event.criteriaName}
                        </Badge>
                        <Badge className="bg-green-500 hover:bg-green-600 text-white">
                          +{event.points} điểm
                        </Badge>
                      </div>
                      <CardTitle className="text-xl text-balance">
                        {event.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          <span>{formattedDate}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span>{event.time}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-4 h-4" />
                          <span>{event.location}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Briefcase className="w-4 h-4" />
                          <span>{event.organizer}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Users className="w-4 h-4" />
                          <span>
                            {event.participants != null &&
                            event.maxParticipants != null ? (
                              <>
                                {event.participants}/{event.maxParticipants}{' '}
                                người đăng ký ({participantPercent.toFixed(0)}%)
                              </>
                            ) : (
                              <>Không có dữ liệu số lượng tham gia</>
                            )}
                          </span>
                        </div>
                        {event.registrationDeadline && (
                          <div className="flex items-center gap-2 text-red-500/80 mt-1">
                            <AlertCircle className="w-4 h-4" />
                            <span>
                              Hạn đăng ký:{' '}
                              {new Date(
                                event.registrationDeadline,
                              ).toLocaleString('vi-VN', {
                                timeZone: 'Asia/Ho_Chi_Minh',

                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="pt-2">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => router.push(`/events/${event.id}`)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            Xem chi tiết
                          </Button>
                          {event.userRegistrationStatus ===
                          REGISTRATION_STATUS.REGISTERED ? (
                            <Button
                              className="flex-1 bg-secondary text-secondary-foreground"
                              disabled
                            >
                              Đã đăng ký
                            </Button>
                          ) : event.userRegistrationStatus ===
                            REGISTRATION_STATUS.ATTENDED ? (
                            <Button
                              className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                              disabled
                            >
                              Đã tham gia
                            </Button>
                          ) : event.userRegistrationStatus ===
                            REGISTRATION_STATUS.CANCELLED ? (
                            <Button
                              className="flex-1 bg-destructive hover:bg-destructive/90 text-white"
                              disabled
                            >
                              Đã hủy
                            </Button>
                          ) : (
                            <Button
                              className="flex-1"
                              onClick={() => handleRegisterClick(event)}
                            >
                              Đăng ký
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {filteredEvents.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <p className="text-muted-foreground">
                    Không tìm thấy sự kiện nào phù hợp
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Registration Modal */}
            <RegisterEventModal
              event={selectedEvent}
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              onConfirm={handleRegisterConfirm}
              isRegistering={isRegistering}
            />
          </>
        )}
      </main>
    </div>
  );
}
