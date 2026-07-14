# Tài liệu kỹ thuật: Google Calendar Integration Module

## Tổng quan

Module `google-calendar` tích hợp Google Calendar API vào hệ thống CTU Infinity Backend (NestJS). Phiên bản hiện tại sử dụng một tài khoản Google cố định (service account approach với refresh token) — tức là tất cả sự kiện đều được tạo trên lịch của một tài khoản quản trị duy nhất.

Thư mục: `src/modules/google-calendar/`

---

## Cấu trúc module

```
src/modules/google-calendar/
├── dto/
│   └── create-calendar-event.dto.ts
├── google-calendar.controller.ts
├── google-calendar.service.ts
└── google-calendar.module.ts
```

---

## Data Transfer Object (DTO)

File: `dto/create-calendar-event.dto.ts`

DTO này định nghĩa cấu trúc dữ liệu đầu vào cho API tạo sự kiện. NestJS `ValidationPipe` sẽ tự động reject request nếu dữ liệu không hợp lệ trước khi request đến tầng service.

| Field | Kiểu | Bắt buộc | Validator | Mô tả |
|-------|------|----------|-----------|-------|
| `summary` | string | Có | `@IsNotEmpty`, `@IsString` | Tiêu đề sự kiện hiển thị trên Google Calendar |
| `description` | string | Không | `@IsOptional`, `@IsString` | Mô tả nội dung sự kiện |
| `location` | string | Không | `@IsOptional`, `@IsString` | Địa điểm tổ chức |
| `startTime` | string | Có | `@IsNotEmpty`, `@IsISO8601` | Thời gian bắt đầu, bắt buộc đúng định dạng ISO 8601 |
| `endTime` | string | Có | `@IsNotEmpty`, `@IsISO8601` | Thời gian kết thúc, bắt buộc đúng định dạng ISO 8601 |

Ví dụ giá trị `startTime` và `endTime` hợp lệ: `"2026-04-01T08:00:00+07:00"`

Nếu truyền sai định dạng, hệ thống trả về HTTP 400 Bad Request tự động, không cần xử lý thêm trong service.

---

## Service

File: `google-calendar.service.ts`

### Constructor

```typescript
constructor(private readonly configService: ApiConfigService)
```

Được gọi một lần khi NestJS khởi động module. Thực hiện:

1. Đọc 4 biến cấu hình từ `ApiConfigService`: `clientId`, `clientSecret`, `redirectUri`, `refreshToken`
2. Khởi tạo `OAuth2Client` từ thư viện `google-auth-library`
3. Gán `refresh_token` vào OAuth2Client bằng `setCredentials()`

Từ thời điểm này, `this.oauth2Client` được tái sử dụng cho mọi request — Google sẽ tự động dùng refresh token để lấy access token mới khi cần, không cần xử lý thủ công.

---

### `createCalendarEvent(dto: CreateCalendarEventDto)`

Phương thức chính của module. Được gọi bởi controller khi có POST request đến `/google-calendar/create-event`.

Luồng xử lý:

1. Khởi tạo Google Calendar API client với `this.oauth2Client` đã có sẵn credentials
2. Tạo object `eventBody` chứa `summary`, `description`, `location`, `start`, `end` với timezone cố định là `Asia/Ho_Chi_Minh`
3. Gọi `calendar.events.insert()` với `calendarId: 'primary'` — tức là tạo sự kiện trên lịch chính của tài khoản Google đã cấu hình
4. Nếu thành công: log thông tin sự kiện, trả về object `{ EC: 1, EM: '...', data: { eventId, htmlLink, summary, start, end } }`
5. Nếu lỗi: log lỗi, throw `InternalServerErrorException` với `{ EC: 0, EM: '...' }`

Lưu ý: Chỉ trả về các trường cần thiết từ Google API response (`eventId`, `htmlLink`, `summary`, `start`, `end`), không expose toàn bộ response để tránh dữ liệu thừa.

---

### `getAuthorizationUrl()`

Phương thức hỗ trợ, chỉ dùng trong giai đoạn setup lần đầu.

Luồng xử lý:

1. Đọc lại config từ `ApiConfigService`
2. Tạo một `OAuth2Client` mới (tách biệt với `this.oauth2Client` chính)
3. Gọi `generateAuthUrl()` với `access_type: 'offline'` và `scope: ['https://www.googleapis.com/auth/calendar']`
4. Tham số `prompt: 'consent'` bắt buộc Google hiển thị màn hình đồng ý ngay cả khi user đã authorize trước đó — cần thiết để Google trả về `refresh_token` trong response

Trả về: URL string để redirect user đến màn hình đăng nhập Google.

---

### `getTokensFromCode(code: string)`

Phương thức hỗ trợ, chỉ dùng trong giai đoạn setup lần đầu.

Luồng xử lý:

1. Tạo `OAuth2Client` mới
2. Gọi `getToken(code)` — exchange authorization code thành token pair
3. Trả về `{ accessToken, refreshToken, expiresAt }` đã được format

Luồng lỗi: Nếu `code` đã hết hạn hoặc không hợp lệ, Google trả về lỗi và service throw `InternalServerErrorException`.

Quan trọng: `refreshToken` chỉ xuất hiện trong response của lần exchange đầu tiên. Nếu bỏ lỡ, phải revoke quyền và làm lại từ đầu.

---

## Controller

File: `google-calendar.controller.ts`

Base route: `/google-calendar`

---

### POST `/google-calendar/create-event`

Decorator:
- `@Permission('Create a calendar event', SYSTEM_MODULE.GOOGLE_CALENDAR)` — yêu cầu JWT hợp lệ và user có quyền này
- `@ResponseMessage('Create a calendar event')` — gán message vào response wrapper của hệ thống

Đây là endpoint chính dùng trong production.

Request body: `CreateCalendarEventDto`

Response thành công (HTTP 201):
```json
{
  "statusCode": 201,
  "message": "Create a calendar event",
  "data": {
    "EC": 1,
    "EM": "Tạo sự kiện trên Google Calendar thành công",
    "data": {
      "eventId": "abc123xyz",
      "htmlLink": "https://www.google.com/calendar/event?eid=...",
      "summary": "Thi OOP cuối kỳ",
      "start": { "dateTime": "2026-04-01T08:00:00+07:00", "timeZone": "Asia/Ho_Chi_Minh" },
      "end": { "dateTime": "2026-04-01T10:00:00+07:00", "timeZone": "Asia/Ho_Chi_Minh" }
    }
  }
}
```

Response lỗi validation (HTTP 400):
```json
{
  "statusCode": 400,
  "message": ["startTime phải là định dạng ISO8601 (ví dụ: 2026-04-01T08:00:00+07:00)"]
}
```

---

### GET `/google-calendar/auth-url`

Decorator: `@Public()` — không cần JWT.

Mục đích: Trả về URL để admin đăng nhập Google và cấp quyền Calendar trong lần setup đầu tiên. Không dùng trong production.

Response (HTTP 200):
```json
{
  "EC": 1,
  "EM": "Authorization URL generated",
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
  }
}
```

---

### GET `/google-calendar/auth-callback`

Decorator: `@Public()` — không cần JWT.

Query param: `code` (string) — authorization code do Google gửi về sau khi user đồng ý.

Mục đích: Exchange code để lấy refresh token. Endpoint này là callback URL mà Google redirect đến sau khi user đăng nhập.

Response (HTTP 200):
```json
{
  "EC": 1,
  "EM": "Lấy token thành công. Hãy copy refresh_token vào file .env",
  "data": {
    "accessToken": "ya29.xxxx",
    "refreshToken": "1//xxxx",
    "expiresAt": "2026-03-05T10:00:00.000Z"
  }
}
```

Sau khi nhận `refreshToken`, paste vào `.env` tại `GOOGLE_REFRESH_TOKEN` và restart server.

---

## Luồng test đầy đủ

### Bước 1: Chuẩn bị Google Cloud Console

1. Vào https://console.cloud.google.com
2. Tạo project mới hoặc chọn project có sẵn
3. Vào "APIs & Services" > "Enable APIs" > tìm và bật "Google Calendar API"
4. Vào "APIs & Services" > "Credentials" > "Create Credentials" > "OAuth 2.0 Client IDs"
5. Chọn Application type là "Web application"
6. Thêm authorized redirect URI: `http://localhost:8080/google-calendar/auth-callback`
7. Copy `Client ID` và `Client Secret` vào file `.env`

### Bước 2: Lấy Refresh Token (chỉ làm 1 lần)

1. Khởi động server: `npm run dev`
2. Gọi GET request đến `http://localhost:8080/google-calendar/auth-url` (không cần JWT)
3. Copy `data.authUrl` từ response, mở trong trình duyệt
4. Đăng nhập bằng tài khoản Google sẽ dùng làm lịch chính (nên là tài khoản admin/tổ chức)
5. Màn hình xin quyền xuất hiện — chọn "Allow"
6. Trình duyệt redirect về `http://localhost:8080/google-calendar/auth-callback?code=xxxx`
7. Response hiển thị trên màn hình hoặc có thể xem trong tab network — copy `refreshToken`
8. Paste vào `.env`: `GOOGLE_REFRESH_TOKEN=1//xxxx...`
9. Restart server

### Bước 3: Test tạo sự kiện

Dùng Postman hoặc curl:

```
POST http://localhost:8080/google-calendar/create-event
```

Headers:
```
Content-Type: application/json
Authorization: Bearer <JWT_token_của_user_đã_đăng_nhập_hệ_thống>
```

Body:
```json
{
  "summary": "Thi OOP cuối kỳ",
  "description": "Thi học phần Lập trình Hướng đối tượng",
  "location": "Phòng A101 - Trường ĐH Cần Thơ",
  "startTime": "2026-04-01T08:00:00+07:00",
  "endTime": "2026-04-01T10:00:00+07:00"
}
```

Kết quả mong đợi: Response HTTP 201, và sự kiện xuất hiện trong Google Calendar của tài khoản đã cấu hình.

### Bước 4: Test các trường hợp lỗi

Test validation — gửi `startTime` sai định dạng:
```json
{ "summary": "Test", "startTime": "2026/04/01", "endTime": "2026-04-01T10:00:00+07:00" }
```
Kết quả mong đợi: HTTP 400 với message validation lỗi.

Test không có JWT — gửi request không có header `Authorization`:
Kết quả mong đợi: HTTP 401 Unauthorized.

Test Google token hết hạn — xảy ra tự động nếu refresh token bị revoke:
Kết quả mong đợi: HTTP 500 với `{ EC: 0, EM: 'Lỗi khi tạo sự kiện trên Google Calendar' }` và log lỗi chi tiết trong console.

---

## Cách tiếp cận thực tế khi đưa lên production nhiều user

### Giới hạn của thiết kế hiện tại

Thiết kế hiện tại dùng một refresh token cố định, tức là tất cả sự kiện đều tạo trên lịch của một tài khoản Google duy nhất. Các user của hệ thống CTU Infinity chỉ nhận được link `htmlLink` để xem sự kiện, không có sự kiện trong Google Calendar cá nhân của họ.

Đây là thiết kế phù hợp khi hệ thống quản lý sự kiện tập trung (lịch chung của tổ chức), nhưng không phù hợp nếu muốn tạo sự kiện riêng trong lịch của từng sinh viên.

---

### Phương án 1: Dùng Google Service Account (khuyến nghị cho production tổ chức)

Thay vì OAuth2 với refresh token của cá nhân, dùng Service Account — một tài khoản robot của Google Cloud có thể được cấp quyền truy cập vào Google Workspace Calendar.

Lợi thế:
- Không cần refresh token, không bao giờ hết hạn
- Không cần user đăng nhập Google
- Phù hợp môi trường server không tương tác

Cách cấu hình:
1. Vào Google Cloud Console > "Service Accounts" > tạo service account mới
2. Download file JSON credentials
3. Trong Google Workspace Admin: cấp "Domain-wide Delegation" cho service account
4. Trong code: dùng `google.auth.GoogleAuth` với `keyFile` thay vì `OAuth2Client`

Thay đổi trong service:
```typescript
// Thay constructor hiện tại bằng:
const auth = new google.auth.GoogleAuth({
  keyFile: 'path/to/service-account.json',
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth });
```

---

### Phương án 2: Per-user OAuth2 (khi muốn tạo sự kiện trong lịch cá nhân của từng user)

Nếu muốn mỗi sinh viên có sự kiện ngay trong Google Calendar cá nhân của họ, cần lưu `refreshToken` riêng cho từng user.

Các thay đổi cần thiết:

Thêm cột vào bảng User trong database:
```
googleRefreshToken: string (nullable, encrypted)
```

Flow:
1. User bấm "Kết nối Google Calendar" trong frontend
2. Frontend gọi `/google-calendar/auth-url` để lấy Google login URL
3. User đăng nhập Google
4. Backend nhận callback, lưu `refreshToken` vào database theo `userId`
5. Khi tạo sự kiện, backend đọc `refreshToken` của user đó từ DB và dùng để gọi API

Thay đổi trong service:
- `createCalendarEvent()` nhận thêm `userId` hoặc `refreshToken` làm tham số
- Mỗi request tạo một `OAuth2Client` riêng với token của user đó

Vấn đề cần xử lý:
- Mã hóa `refreshToken` khi lưu trong DB (không lưu plain text)
- Xử lý trường hợp user chưa kết nối Google (token null)
- Xử lý khi token bị revoke (user thu hồi quyền từ phía Google)

---

### Phương án 3: Chỉ gửi link sự kiện qua email (đơn giản nhất)

Thay vì tạo sự kiện trong Calendar cá nhân của user, tạo sự kiện trên lịch tổ chức rồi gửi `htmlLink` qua email cho sinh viên.

Sinh viên mở link và có thể thêm sự kiện vào lịch cá nhân bằng cách bấm "Add to Calendar" trong giao diện Google Calendar.

Cách tích hợp: Sau khi `createCalendarEvent()` trả về `htmlLink`, gọi `emailService.sendEventInvitation(userEmail, htmlLink, eventDetails)`.

Đây là cách đơn giản nhất và phù hợp nhất với thiết kế hiện tại của hệ thống.

---

### Bảo mật trong production

Endpoint `/auth-url` và `/auth-callback` hiện đang là `@Public()` — bất kỳ ai cũng có thể gọi. Khi deploy production cần:

1. Thêm guard kiểm tra IP hoặc chỉ cho phép `ADMIN` role gọi hai endpoint này
2. Hoặc xóa hẳn hai endpoint này sau khi đã lấy xong refresh token
3. Không commit `GOOGLE_REFRESH_TOKEN` vào git — dùng secret management (AWS Secrets Manager, Vault, v.v.)
4. Đặt `GOOGLE_REDIRECT_URI` đúng với domain production, không dùng localhost

---

## Lưu ý về rate limit

Google Calendar API có giới hạn:
- 1,000,000 requests/ngày per project (đủ cho hầu hết use case)
- 500 requests/100 giây per user

Nếu hệ thống có nhiều sự kiện được tạo đồng thời, cần thêm retry logic với exponential backoff khi gặp lỗi HTTP 429 (Too Many Requests) từ Google API.
