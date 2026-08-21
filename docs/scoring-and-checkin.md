# Quy Trình Cộng Điểm & Check-in QR Code — Tài Liệu Kỹ Thuật

> Nguồn: phân tích trực tiếp từ source code NestJS backend (`ctu_infinity_backend`).

---

## 1. Tổng Quan Nghiệp Vụ

Hệ thống điểm rèn luyện của CTU Infinity hoạt động theo quy trình khép kín:

```
Tạo sự kiện → Đăng ký → Check-in (QR/thủ công) → Duyệt → Cộng điểm
```

Mỗi sự kiện được gán một **tiêu chí** (Criteria) và một **số điểm** (score). Khi sinh viên tham dự sự kiện và được xác nhận, điểm sẽ được cộng vào tài khoản rèn luyện của sinh viên theo đúng tiêu chí tương ứng.

---

## 2. Các Entity Chính

### 2.1. Event

**File:** `ctu_infinity_backend/src/modules/events/entities/event.entity.ts`

```typescript
export class Event {
    eventId: string;           // UUID, primary key
    eventName: string;
    eventSlug: string;        // unique slug cho URL
    description: string | null;
    location: string | null;
    startDate: Date;
    endDate: Date;
    registrationDeadline: Date | null;
    maxParticipants: number | null;
    status: EVENT_STATUS;      // DRAFT | PENDING | APPROVED | REJECTED
    criteriaId: string | null; // FK sang Criteria, được gán khi duyệt
    score: number | null;       // Điểm của sự kiện, được gán khi duyệt
    requiresApproval: boolean; // true → cần admin duyệt attendance
    qrCodeToken: string | null;// JWT token cho QR code check-in
    semesterId: string | null; // Được xác định tự động khi duyệt
    // ... audit fields
}
```

**Trạng thái sự kiện (EVENT_STATUS):**

| Trạng thái | Ý nghĩa | Có thể check-in? |
|---|---|---|
| `DRAFT` | Sự kiện đang được soạn thảo | Không |
| `PENDING` | Chờ admin duyệt | Không |
| `APPROVED` | Đã duyệt, có thể check-in | **Có** |
| `REJECTED` | Bị từ chối | Không |

---

### 2.2. Criteria & CriteriaFrame

**File:** `ctu_infinity_backend/src/modules/criteria-frame/entities/criteria-frame.entity.ts`
**File:** `ctu_infinity_backend/src/modules/criterias/entities/criteria.entity.ts`

```typescript
// CriteriaFrame: Khung tiêu chí (ví dụ: "Khung điểm rèn luyện 2024-2025 v1.0")
export class CriteriaFrame {
    frameworkId: string;
    frameworkName: string;
    version: string;           // "v1.0"
    startDate: Date;
    endDate: Date | null;
    status: FrameworkStatus;   // DRAFT | ACTIVE | ARCHIVED
    isActive: boolean;         // Chỉ 1 khung ACTIVE tại 1 thời điểm
    criterias: Criteria[];     // Tiêu chí con
}

// Criteria: Tiêu chí cụ thể (I, II, III, IV, V)
export class Criteria {
    criteriaId: string;
    frameworkId: string;       // FK sang CriteriaFrame
    parentId: string | null;  // Cho tiêu chí có cấp cha/con
    criteriaCode: string;      // "I", "II", "III", "IV", "V"
    criteriaName: string;      // "Đạo đức, tinh thần chính trị..."
    maxScore: number;          // Điểm tối đa của tiêu chí (VD: 25)
    displayOrder: number;
}
```

---

### 2.3. StudentScore

**File:** `ctu_infinity_backend/src/modules/student-score/entities/student-score.entity.ts`

```typescript
export class StudentScore {
    id: string;                // UUID, primary key
    studentId: string;          // FK sang Student
    eventId: string;           // FK sang Event
    criteriaId: string;         // FK sang Criteria
    scoreValue: number;         // Điểm thực tế được cộng (số nguyên)
    semesterId: string | null;  // Học kỳ mà điểm được ghi nhận
    createdAt: Date;           // Timestamp tự động
}
```

> **Nguyên tắc quan trọng:** Mỗi lần cộng điểm tạo **một record mới**. Không cộng trực tiếp vào bảng Student. Tổng điểm được tính bằng `SUM(scoreValue) GROUP BY criteriaId`.

---

### 2.4. EventRegistration

**File:** `ctu_infinity_backend/src/modules/event-registration/entities/event-registration.entity.ts`

```typescript
export enum REGISTRATION_STATUS {
    REGISTERED = 'REGISTERED',  // Đã đăng ký, chưa điểm danh
    CANCELLED = 'CANCELLED',    // Đã hủy đăng ký
    ATTENDED = 'ATTENDED',      // Đã điểm danh
    ABSENT = 'ABSENT',           // Vắng mặt (sau khi sự kiện kết thúc)
}

export class EventRegistration {
    id: string;                // UUID
    studentId: string;          // FK
    eventId: string;           // FK
    status: REGISTRATION_STATUS; // Trạng thái
    registeredAt: Date;         // Thời điểm đăng ký
    attendedAt: Date | null;     // Thời điểm điểm danh thành công
    cancelledAt: Date | null;    // Thời điểm hủy
}

@Index(['studentId', 'eventId'], { unique: true })
// Mỗi sinh viên chỉ đăng ký 1 lần / 1 sự kiện
```

---

### 2.5. EventAttendance

**File:** `ctu_infinity_backend/src/modules/event-attendance/entities/event-attendance.entity.ts`

```typescript
export enum ATTENDANCE_STATUS {
    PENDING = 'PENDING',    // Chờ admin duyệt (nếu requiresApproval=true)
    APPROVED = 'APPROVED',   // Đã duyệt → điểm đã cộng
    REJECTED = 'REJECTED',   // Bị từ chối → không cộng điểm
}

export enum CHECK_IN_METHOD {
    QR = 'QR',           // Quét QR code
    MANUAL = 'MANUAL',   // Admin điểm danh thủ công
}

export class EventAttendance {
    id: string;                   // UUID
    studentId: string;            // FK
    eventId: string;              // FK
    status: ATTENDANCE_STATUS;    // PENDING | APPROVED | REJECTED
    checkInMethod: CHECK_IN_METHOD; // QR | MANUAL
    createdAt: Date;
}
```

---

## 3. Chi Tiết Từng File

### 3.1. `event.service.ts` — Tạo & Duyệt Sự Kiện

**Đường dẫn:** `ctu_infinity_backend/src/modules/events/event.service.ts`

#### Hàm `approveEvent()`

```typescript
async approveEvent(eventId: string, dto: ApproveEventDto, userId?: string) {
    // 1. Kiểm tra event ở trạng thái PENDING
    // 2. Lấy Criteria để lấy maxScore
    const criteria = await criteriasService.findOne(dto.criteriaId);
    const maxScore = criteria.maxScore;

    // 3. Ràng buộc: dto.score <= maxScore (nguyên, không âm)
    if (maxScore !== null && dto.score > maxScore) {
        throw BadRequestException(`Số điểm (${dto.score}) vượt quá maxScore (${maxScore})`);
    }

    // 4. Tự động xác định semesterId từ startDate
    const semesterId = await this.findSemesterByEventDate(event.startDate);

    // 5. Cập nhật: status=APPROVED, criteriaId, score, approvedBy, approvedAt, semesterId
    await eventRepository.update({ eventId }, {
        status: EVENT_STATUS.APPROVED,
        criteriaId: dto.criteriaId,
        score: dto.score,
        approvedBy: userId,
        approvedAt: new Date(),
        semesterId,
    });

    // 6. Fire-and-forget: gửi email thông báo cho subscribers
    this.sendApprovalNotificationsAsync(approvedEvent, dto).catch(...);
}
```

**Ràng buộc tại đây:**
- `score` phải là số nguyên không âm
- `score` không được vượt `maxScore` của Criteria
- `event.status` phải là `PENDING`
- `criteriaId` phải tồn tại

#### Hàm `findSemesterByEventDate()`

```typescript
private async findSemesterByEventDate(eventStartDate: Date): Promise<string | null> {
    // Duyệt tất cả semester
    // Nếu event.startDate nằm trong [startDate, endDate] → trả semester đó
    // Fallback: lấy semester hiện tại (isCurrent=true)
}
```

**Tự động gán semesterId** dựa trên ngày diễn ra của sự kiện.

#### Hàm `generateQrToken()`

```typescript
async generateQrToken(eventId: string, expiresInMinutes: number = 120): Promise<string> {
    // Tạo JWT token chứa { eventId, iat, exp }
    // Secret: ACCESS_TOKEN_SECRET (dùng chung với JWT auth)
    // Mặc định hết hạn sau 120 phút
    const token = this.jwtService.sign(
        { eventId },
        { expiresIn: `${expiresInMinutes}m` }
    );

    // Lưu vào event.qrCodeToken
    await eventRepository.update({ eventId }, { qrCodeToken: token });

    return token;  // QR code = mã hóa token này thành QR image
}
```

**Bảo mật QR:** Token là JWT với expiration. Nếu QR bị chụp ảnh và share, token tự hết hạn sau 120 phút.

---

### 3.2. `event-attendance.service.ts` — Check-in

**Đường dẫn:** `ctu_infinity_backend/src/modules/event-attendance/event-attendance.service.ts`

#### Hàm `checkIn()` — Quét QR Code

```typescript
async checkIn(dto: CheckInDto) {
    // 1. Verify JWT token từ QR
    const payload = this.jwtService.verify(dto.qrToken, {
        secret: this.configService.authConfig.access_token_key,
    });
    eventId = payload.eventId;

    // 2. Kiểm tra event tồn tại và đã APPROVED
    if (event.status !== EVENT_STATUS.APPROVED) {
        throw BadRequestException('Sự kiện chưa được duyệt, không thể check-in');
    }

    // 3. Kiểm tra chưa check-in rồi
    const existing = await attendanceRepository.findOne({
        where: { studentId: dto.studentId, eventId }
    });
    if (existing) {
        throw ConflictException('Sinh viên đã check-in sự kiện này rồi');
    }

    // 4. Xác định trạng thái attendance ban đầu
    const initialStatus = event.requiresApproval
        ? ATTENDANCE_STATUS.PENDING   // Cần admin duyệt → chờ
        : ATTENDANCE_STATUS.APPROVED; // Không cần duyệt → tự động approve

    // 5. Tạo EventAttendance record
    await attendanceRepository.save({
        studentId: dto.studentId,
        eventId: event.eventId,
        status: initialStatus,
        checkInMethod: CHECK_IN_METHOD.QR,
    });

    // 6. Cập nhật EventRegistration → ATTENDED
    await registrationRepository.update(
        { studentId: dto.studentId, eventId: event.eventId },
        { status: REGISTRATION_STATUS.ATTENDED, attendedAt: new Date() }
    );

    // 7. Nếu không yêu cầu duyệt → cộng điểm ngay
    if (!event.requiresApproval && event.criteriaId && event.score !== null) {
        await studentScoreService.addScoreForEvent(
            dto.studentId,
            event.eventId,
            event.criteriaId,
            this.normalizeEventScore(event.score),
            event.semesterId,
        );
    }

    return {
        EM: event.requiresApproval
            ? 'Check-in thành công. Điểm sẽ được cộng sau khi admin duyệt.'
            : 'Check-in thành công. Điểm đã được cộng tự động.',
        status: initialStatus,
    };
}
```

#### Hàm `checkInByUser()` — QR với JWT user

```typescript
async checkInByUser(userId: string, dto: CheckInByUserDto) {
    // 1. Tìm student từ userId (JWT đã xác thực ở guard)
    const student = await studentRepository.findOne({ where: { userId } });

    // 2. Gọi lại checkIn() với studentId
    return this.checkIn({ studentId: student.studentId, qrToken: dto.qrToken });
}
```

> **Điểm khác biệt:** `checkIn()` nhận `studentId` từ body (dùng khi admin gọi), `checkInByUser()` tự động lấy từ JWT token của sinh viên đang đăng nhập.

#### Hàm `manualCheckIn()` — Điểm Danh Thủ Công

```typescript
async manualCheckIn(dto: ManualCheckInDto) {
    // 1. Kiểm tra event APPROVED
    // 2. Kiểm tra sinh viên ĐÃ ĐĂNG KÝ (status = REGISTERED)
    const registration = await registrationRepository.findOne({
        where: { studentId: dto.studentId, eventId: dto.eventId }
    });
    if (!registration) {
        throw NotFoundException('Sinh viên chưa đăng ký sự kiện này');
    }
    if (registration.status === REGISTRATION_STATUS.CANCELLED) {
        throw BadRequestException('Sinh viên đã hủy đăng ký');
    }
    if (registration.status === REGISTRATION_STATUS.ATTENDED) {
        throw ConflictException('Sinh viên đã được điểm danh trước đó');
    }

    // 3. Tạo EventAttendance với checkInMethod = MANUAL
    // 4. Cập nhật EventRegistration → ATTENDED
    // 5. Cộng điểm nếu !requiresApproval
}
```

**Ràng buộc quan trọng:** Sinh viên phải có đăng ký với `status = REGISTERED` mới được điểm danh thủ công. Không cho phép điểm danh nếu đã hủy hoặc đã attended.

#### Hàm `approveAttendance()` — Duyệt Attendance

```typescript
async approveAttendance(attendanceId: string) {
    return await this.dataSource.transaction(async (manager) => {
        // 1. Tìm attendance, kiểm tra status = PENDING
        // 2. Cập nhật status → APPROVED
        await manager.update(EventAttendance, { id: attendanceId }, {
            status: ATTENDANCE_STATUS.APPROVED
        });

        // 3. Lấy event để biết criteriaId và score
        const event = await eventService.findEventEntity(attendance.eventId);

        // 4. Cộng điểm cho sinh viên
        if (event && event.criteriaId && event.score !== null) {
            await studentScoreService.addScoreForEvent(
                attendance.studentId,
                attendance.eventId,
                event.criteriaId,
                this.normalizeEventScore(event.score),
                event.semesterId,
            );
        }

        return { EM: 'Duyệt điểm danh và cộng điểm thành công' };
    });
}
```

**Dùng transaction:** Đảm bảo atomicity — nếu cộng điểm thất bại thì duyệt attendance cũng bị rollback.

#### Hàm `rejectAttendance()`

Cập nhật `status → REJECTED`. Không cộng điểm. EventRegistration giữ nguyên (không quay lại REGISTERED).

#### Hàm `normalizeEventScore()`

```typescript
private normalizeEventScore(score: unknown): number {
    const normalized = Number(score);
    if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < 0) {
        throw BadRequestException('Điểm sự kiện phải là số nguyên không âm');
    }
    return normalized;
}
```

---

### 3.3. `student-score.service.ts` — Cộng & Tổng Hợp Điểm

**Đường dẫn:** `ctu_infinity_backend/src/modules/student-score/student-score.service.ts`

#### Hàm `addScoreForEvent()`

```typescript
async addScoreForEvent(
    studentId: string,
    eventId: string,
    criteriaId: string,
    score: number,
    semesterId: string | null,
): Promise<void> {
    const normalizedScore = this.ensureNaturalInteger(score, 'score');

    const newScore = this.scoreRepository.create({
        studentId,
        eventId,
        criteriaId,
        scoreValue: normalizedScore,
        semesterId,
    });

    await this.scoreRepository.save(newScore);
    // Tạo 1 record mới — KHÔNG cộng dồn vào record cũ
}
```

**Không có kiểm tra maxScore tại đây.** Ràng buộc `score <= maxScore` được enforce ở bước `approveEvent()` trong `event.service.ts`.

> **Thiếu sót:** Không có kiểm tra tổng điểm sau khi cộng. Nếu sinh viên tham gia nhiều sự kiện cùng tiêu chí, tổng điểm có thể vượt `maxScore` của Criteria.

#### Hàm `getStudentScores()` — Tổng Hợp Theo Tiêu Chí

```typescript
async getStudentScores(studentId: string, semesterId?: string) {
    const where: any = { studentId };
    if (semesterId) where.semesterId = semesterId;

    const records = await this.scoreRepository.find({
        where,
        relations: ['event'],
        order: { createdAt: 'DESC' },
    });

    // Gom nhóm và tính tổng theo criteriaId
    const totals: Record<string, number> = {};
    for (const r of records) {
        totals[r.criteriaId] = (totals[r.criteriaId] ?? 0) + Number(r.scoreValue);
    }

    return {
        scores: records,                    // Danh sách record chi tiết
        totalsByCriteriaId: totals,         // Tổng theo tiêu chí
    };
}
```

**Kết quả mẫu:**

```json
{
    "scores": [
        { "id": "...", "studentId": "A", "criteriaId": "crit-I", "scoreValue": 5, "eventId": "evt-1" },
        { "id": "...", "studentId": "A", "criteriaId": "crit-I", "scoreValue": 10, "eventId": "evt-3" }
    ],
    "totalsByCriteriaId": {
        "crit-I": 15,
        "crit-II": 8
    }
}
```

#### Hàm `getMyScores()` — Lấy Điểm Sinh Viên Hiện Tại

```typescript
async getMyScores(userId: string, filter: MyScoresFilterDto) {
    // 1. Tìm student từ userId
    const student = await studentRepository.findOne({ where: { userId } });

    // 2. Query với filter
    // Ưu tiên: semesterId
    // Fallback: startDate + endDate (date range của sự kiện)
    const queryBuilder = this.scoreRepository.createQueryBuilder('ss')
        .leftJoinAndSelect('ss.event', 'event')
        .where('ss.studentId = :studentId', { studentId });

    if (filter.semesterId) {
        queryBuilder.andWhere('ss.semesterId = :semesterId', ...);
    } else {
        if (filter.startDate) queryBuilder.andWhere('event.startDate >= :startDate', ...);
        if (filter.endDate)   queryBuilder.andWhere('event.startDate <= :endDate', ...);
    }

    // 3. Tính tổng theo criteriaId
    const records = await queryBuilder.getMany();
    const totals: Record<string, number> = {};
    for (const r of records) {
        totals[r.criteriaId] = (totals[r.criteriaId] ?? 0) + Number(r.scoreValue);
    }

    return { scores: records, totalsByCriteriaId: totals };
}
```

---

### 3.4. Controller Endpoints

**File:** `ctu_infinity_backend/src/modules/event-attendance/event-attendance.controller.ts`

| Endpoint | Method | Decorator | Mô tả |
|---|---|---|---|
| `/event-attendances/check-in` | POST | `Permission('Check-in event')` | Quét QR (body có studentId) |
| `/event-attendances/check-in-by-user` | POST | `Permission('Check-in event')` | Quét QR (studentId từ JWT) |
| `/event-attendances/manual-check-in` | POST | `Permission('Manual check-in event')` | Điểm danh thủ công |
| `/event-attendances` | GET | `Permission('Get all event attendances')` | Danh sách attendance |
| `/event-attendances/event/:eventId` | GET | `Permission('Get attendances by event')` | Attendance theo sự kiện |
| `PATCH /event-attendances/:id/approve` | PATCH | `Permission('Approve attendance')` | Duyệt → cộng điểm |
| `PATCH /event-attendances/:id/reject` | PATCH | `Permission('Reject attendance')` | Từ chối |

---

## 4. Luồng Tổng Hợp Điểm Chi Tiết

### 4.1. Luồng Check-in + Cộng Điểm Tự Động (`requiresApproval = false`)

```
Sinh viên quét QR code
        │
        ▼
POST /event-attendances/check-in-by-user
        │
        ├── JwtAuthGuard → xác thực user
        │
        ▼
EventAttendanceService.checkIn()
        │
        ├── 1. verify JWT (qrToken) → eventId
        ├── 2. find event → kiểm tra APPROVED
        ├── 3. Kiểm tra chưa check-in (unique constraint)
        │
        ▼
Tạo EventAttendance { status: APPROVED, checkInMethod: QR }
        │
        ▼
Cập nhật EventRegistration.status → ATTENDED
        │
        ▼
studentScoreService.addScoreForEvent()
        │
        ├── normalizeEventScore(event.score)
        ├── Tạo StudentScore record mới
        │   { studentId, eventId, criteriaId, scoreValue: event.score, semesterId }
        └── Lưu vào DB
        │
        ▼
Response: "Check-in thành công. Điểm đã được cộng tự động."
```

### 4.2. Luồng Check-in + Duyệt Thủ Công (`requiresApproval = true`)

```
Sinh viên quét QR code
        │
        ▼
POST /event-attendances/check-in-by-user
        │
        ▼
EventAttendanceService.checkIn()
        │
        ├── Tạo EventAttendance { status: PENDING }
        ├── Cập nhật EventRegistration → ATTENDED
        └── KHÔNG cộng điểm (vì requiresApproval=true)
        │
        ▼
Admin xem danh sách PENDING
        │
        ▼
PATCH /event-attendances/:id/approve
        │
        ▼
EventAttendanceService.approveAttendance()
        │
        ├── dataSource.transaction()
        ├── Cập nhật EventAttendance.status → APPROVED
        └── studentScoreService.addScoreForEvent()
            (cộng điểm = event.score)
        │
        ▼
Done
```

### 4.3. Luồng Tổng Hợp Điểm (Xem)

```
Sinh viên gọi GET /student-scores/my-scores
        │
        ├── JwtAuthGuard → xác thực
        ├── Lấy studentId từ userId
        │
        ▼
StudentScoreService.getMyScores()
        │
        ├── Lọc theo semesterId (ưu tiên)
        │   hoặc lọc theo date range của sự kiện (fallback)
        │
        ▼
Lấy tất cả StudentScore records của sinh viên
        │
        ▼
Gom nhóm: totals[criteriaId] = SUM(scoreValue)
        │
        ▼
Trả về:
{
  "scores": [record1, record2, ...],
  "totalsByCriteriaId": {
    "criteria-I": 20,
    "criteria-II": 8,
    ...
  }
}
```

---

## 5. Ràng Buộc Hệ Thống

### 5.1. Ràng buộc trong `approveEvent()`

```
Event phải ở trạng thái PENDING
    ↓
Criteria phải tồn tại (criteriaId hợp lệ)
    ↓
dto.score phải là số nguyên không âm
    ↓
dto.score <= criteria.maxScore (NẾU maxScore != null)
    ↓
Cập nhật: status=APPROVED, criteriaId, score, semesterId
```

### 5.2. Ràng buộc trong `checkIn()`

```
JWT token hết hạn → "Mã QR đã hết hạn"
    ↓
Event không tồn tại → "Sự kiện không tồn tại"
    ↓
Event chưa APPROVED → "Sự kiện chưa được duyệt"
    ↓
Đã check-in rồi → "Sinh viên đã check-in sự kiện này rồi"
    ↓
Tạo attendance + cập nhật registration
    ↓
requiresApproval=false → cộng điểm ngay
requiresApproval=true  → chờ duyệt
```

### 5.3. Ràng buộc trong `manualCheckIn()`

```
Event phải APPROVED
    ↓
Sinh viên phải có đăng ký (REGISTERED)
    ↓
Đăng ký không được CANCELLED
    ↓
Đăng ký chưa ATTENDED (tránh điểm danh 2 lần)
    ↓
Chưa có EventAttendance record cho (studentId, eventId)
```

### 5.4. Ràng buộc trong `approveAttendance()`

```
Attendance phải ở trạng thái PENDING
    ↓
Cập nhật status → APPROVED (trong transaction)
    ↓
Lấy event → criteriaId + score + semesterId
    ↓
Cộng điểm (addScoreForEvent)
```

---

## 6. Quy Trình Check-in QR Hoàn Chỉnh

```
┌──────────────────────────────────────────────────────────────┐
│  BƯỚC 1: Tạo QR Code (Admin/Organizer)                       │
│                                                              │
│  PATCH /events/:id/approve                                   │
│    └── event.status = APPROVED                                │
│    └── event.criteriaId = dto.criteriaId                      │
│    └── event.score = dto.score                                │
│    └── event.semesterId = auto-determined                    │
│                                                              │
│  POST /events/:id/generate-qr                                │
│    └── jwtService.sign({ eventId }, { expiresIn: '120m' })   │
│    └── event.qrCodeToken = token                             │
│    └── QR image = encode(token) → hiển thị cho sinh viên     │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  BƯỚC 2: Sinh viên đăng ký sự kiện                          │
│                                                              │
│  POST /event-registrations                                   │
│    └── EventRegistration { status: REGISTERED }              │
│    └── registeredAt = now                                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  BƯỚC 3: Sự kiện diễn ra                                    │
│                                                              │
│  Sinh viên đến địa điểm                                      │
│  Quét QR code bằng ứng dụng                                 │
│    └── App decode QR → token                                 │
│    └── POST /event-attendances/check-in-by-user             │
│        { qrToken: token }                                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  BƯỚC 4: Xử lý check-in                                     │
│                                                              │
│  checkInByUser(userId, dto)                                  │
│    └── checkIn({ studentId, qrToken })                       │
│        └── verify(qrToken) → eventId                         │
│        └── find event (APPROVED?)                            │
│        └── find attendance (chưa có?)                         │
│        └── create EventAttendance { APPROVED/PENDING }        │
│        └── update EventRegistration → ATTENDED                 │
│        └── if !requiresApproval: addScoreForEvent()          │
└────────────────────────────┬─────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          │                                       │
          ▼ (requiresApproval=true)         ▼ (requiresApproval=false)
┌─────────────────────────┐    ┌──────────────────────────┐
│  Admin duyệt attendance  │    │  Điểm đã cộng tự động    │
│                         │    │                            │
│  PATCH /attendances/    │    │  Sinh viên kiểm tra:      │
│  :id/approve            │    │  GET /student-scores/     │
│    └── Cộng điểm        │    │  my-scores                 │
│                         │    │    totalsByCriteriaId     │
│  Sinh viên kiểm tra     │    │    → Xem tổng điểm       │
│  điểm của mình         │    │    → Xem còn thiếu bao   │
│                         │    │      nhiêu điểm          │
└─────────────────────────┘    └──────────────────────────┘
```

---

## 7. Điểm Mạnh

1. **Hai lớp duyệt:** Check-in có `requiresApproval` tạo sự linh hoạt — sự kiện nhỏ tự động cộng điểm, sự kiện lớn cần admin xác nhận.

2. **Check-in bằng JWT QR token:** QR code không chứa dữ liệu nhạy cảm, chỉ là JWT signed token. Token tự hết hạn sau 120 phút, chống được việc chia sẻ QR giả.

3. **Transaction cho approveAttendance:** Dùng `dataSource.transaction()` đảm bảo tính atomicity — không xảy ra trường hợp duyệt attendance thành công nhưng điểm không được cộng.

4. **Ràng buộc score <= maxScore ngay bước duyệt sự kiện:** Điểm yếu được chặn từ gốc, không cho phép tạo score record vượt max.

5. **Tự động xác định semesterId:** Hệ thống tự gán học kỳ dựa trên `startDate` của sự kiện, không cần admin chỉ định thủ công.

6. **Unique constraint trên (studentId, eventId):** Tránh trùng lặp check-in ở cả 2 bảng `EventAttendance` và `EventRegistration`.

7. **Separation of concerns rõ ràng:** Mỗi entity có một trách nhiệm duy nhất — Event (sự kiện), EventRegistration (đăng ký), EventAttendance (điểm danh), StudentScore (điểm).

8. **Fire-and-forget notification:** Gửi email thông báo sau duyệt sự kiện không block response, giữ latency thấp.

---

## 8. Điểm Yếu & Cần Cải Thiện

### 8.1. Không kiểm tra tổng điểm vượt maxScore sau khi cộng

Khi `addScoreForEvent()` được gọi, hệ thống **không kiểm tra** tổng điểm hiện tại của sinh viên theo tiêu chí đó có vượt `maxScore` hay không.

**Hậu quả:** Nếu sinh viên tham gia nhiều sự kiện cùng tiêu chí, tổng điểm có thể vượt `maxScore`.

**Cải thiện:** Trong `addScoreForEvent()`, trước khi tạo record:
```typescript
const currentTotal = await scoreRepository
    .createQueryBuilder('ss')
    .select('SUM(ss.scoreValue)', 'total')
    .where('ss.studentId = :studentId', { studentId })
    .andWhere('ss.criteriaId = :criteriaId', { criteriaId })
    .getRawOne();

const newTotal = Number(currentTotal.total) + normalizedScore;
if (newTotal > maxScore) {
    throw BadRequestException(`Tổng điểm (${newTotal}) vượt maxScore (${maxScore})`);
}
```

### 8.2. Không có cơ chế đánh dấu ABSENT tự động

`REGISTRATION_STATUS.ABSENT` được định nghĩa trong entity nhưng **không có logic tự động** chuyển trạng thái từ REGISTERED → ABSENT khi sự kiện kết thúc mà sinh viên không điểm danh.

**Cải thiện:** Thêm scheduled job (NestJS `@Cron`) chạy định kỳ, tìm các EventRegistration có `status=REGISTERED` mà `event.endDate < now`, và cập nhật sang `ABSENT`.

### 8.3. QR token dùng chung secret với JWT access token

```typescript
this.jwtService.verify(dto.qrToken, {
    secret: this.configService.authConfig.access_token_key,
});
```

Dùng cùng một secret có thể gây rủi ro nếu access token secret bị lộ.

**Cải thiện:** Tạo riêng `QR_TOKEN_SECRET` trong config, tách biệt hoàn toàn với access/refresh token.

### 8.4. Không có rate limiting cho check-in endpoint

Endpoint check-in không có rate limit cụ thể, có thể bị brute-force scan QR token.

**Cải thiện:** Thêm `@Throttle` decorator cho các endpoint check-in.

### 8.5. Không lưu ai đã duyệt attendance

`EventAttendance` không có field `approvedBy`/`approvedAt`, không trace được ai đã duyệt điểm danh.

**Cải thiện:** Thêm `approvedBy: string` và `approvedAt: Date` vào `EventAttendance`.

### 8.6. EventRegistration không có role kiểm tra deadline

Hệ thống cho phép điểm danh thủ công bất kỳ lúc nào, không kiểm tra `event.registrationDeadline` hoặc `event.endDate`.

**Cải thiện:** Thêm kiểm tra trong `manualCheckIn()`:
```typescript
if (event.registrationDeadline && new Date() > event.registrationDeadline) {
    throw BadRequestException('Đã quá hạn đăng ký sự kiện');
}
```

### 8.7. Không có API để sửa điểm đã cộng

`StudentScore` chỉ có `create` và `find`, không có `update`. Nếu admin nhập nhầm điểm, không thể sửa mà phải xóa record.

**Cải thiện:** Thêm endpoint `PATCH /student-scores/:id` hoặc `DELETE /student-scores/:id`.

---

## 9. Bảng Tổng Hợp Luồng Dữ Liệu

```
Tạo sự kiện (DRAFT)
        │
        ▼
Duyệt sự kiện (PENDING → APPROVED)
  - Gán criteriaId
  - Gán score (≤ maxScore)
  - Tự động gán semesterId
        │
        ▼
Sinh viên đăng ký
  - Tạo EventRegistration (REGISTERED)
        │
        ├─── Sự kiện diễn ra ───────────────────────────────┐
        │                                                     │
        ▼                                                     ▼
  Quét QR                              Admin điểm danh thủ công
  POST /check-in-by-user               POST /manual-check-in
        │                                                     │
        ├── verify(qrToken) → eventId                        │
        ├── Kiểm tra APPROVED                                │
        ├── Kiểm tra chưa check-in                          │
        ▼                                                     │
  Tạo EventAttendance                                    │
  + Cập nhật Registration → ATTENDED                     │
        │                                                     │
        ├── requiresApproval=false ──→ Cộng điểm ngay        │
        │   addScoreForEvent()                               │
        │   → StudentScore { scoreValue }                    │
        │                                                     │
        └── requiresApproval=true ──→ Chờ duyệt              │
            EventAttendance { PENDING }                     │
                   │                                         │
                   ▼                                         │
            Admin duyệt (transaction)                       │
            PATCH /:id/approve                               │
                   │                                         │
                   └── Cộng điểm                             │
                       addScoreForEvent()                    │
                       → StudentScore { scoreValue }        │
                                                              │
                                                              ▼
                                                    Sinh viên xem điểm
                                                    GET /my-scores
                                                      │
                                                      ▼
                                                    Tổng hợp:
                                                    SUM(scoreValue)
                                                    GROUP BY criteriaId
```
