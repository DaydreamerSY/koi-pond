# Koi Paper

> [!IMPORTANT]
> **Koi Paper được phát triển từ [Nagomi](https://github.com/msk1039/nagomi) của Mayank Kadam ([@msk1039](https://github.com/msk1039)).**
> Toàn bộ hồ cá (mô phỏng cá koi, nước, lá sen, thời tiết, âm thanh) là công sức của tác giả gốc. Bản demo gốc: <https://nagomi-blue.vercel.app>.
> Repo này chỉ thêm chế độ hình nền, một số con vật mới và app hình nền cho Windows/macOS ([danh sách thay đổi](#thay-đổi-so-với-bản-gốc)).
> Đây **không phải** sản phẩm chính thức và không được tác giả gốc bảo trợ. App desktop chính thức của Nagomi: <https://nagomi.m4yank.com>.
> Dùng giấy phép **PolyForm Noncommercial 1.0.0** giống bản gốc: **chỉ dùng phi thương mại** ([LICENSE](LICENSE)).

**English:** Koi Paper is a derivative of [Nagomi](https://github.com/msk1039/nagomi) by Mayank Kadam, which provides the entire pond (koi simulation, water, lotus, weather, sound). This repository adds a wallpaper mode, pond visitors (ducks, crabs, shrimp, frogs), and desktop wallpaper apps for Windows and macOS. It is not an official Nagomi product and is not endorsed by its author; the official desktop app is at <https://nagomi.m4yank.com>. Like the original, it is licensed under the PolyForm Noncommercial License 1.0.0: noncommercial use only. Nagomi's full commit history is kept in `web/`, imported from [msk1039/nagomi@01e93a4](https://github.com/msk1039/nagomi/commit/01e93a410c0a317ee0a2b81e84a71e54a6db81d0).

Koi Paper biến hồ cá Nagomi thành **hình nền động**: cá bơi ngay sau các icon desktop, bấm vào mặt nước thì cá bơi tới.

## Giấy phép

- [`LICENSE`](LICENSE): **PolyForm Noncommercial License 1.0.0**, cùng giấy phép với bản gốc, gồm hai dòng Required Notice: của **Mayank Kadam** (Nagomi) và của **DaydreamerSY** (phần thay đổi trong repo này).
- [`web/LICENSE`](web/LICENSE): giấy phép của Nagomi, giữ nguyên như repo gốc.
- Được: dùng cá nhân, học tập, sửa đổi, chia sẻ **phi thương mại**. Không được: bán, hay dùng cho mục đích thương mại.
- Ai nhận được một bản (mã nguồn hoặc bản build) cũng phải nhận kèm điều khoản giấy phép và các dòng `Required Notice:`. Bản build Windows/macOS đã tự chép `LICENSE-nagomi.txt` vào trong app.

## Thay đổi so với bản gốc

`web/` là Nagomi nhập nguyên lịch sử commit từ [msk1039/nagomi@01e93a4](https://github.com/msk1039/nagomi/commit/01e93a410c0a317ee0a2b81e84a71e54a6db81d0) (git subtree). Xem toàn bộ thay đổi so với bản gốc:

```bash
git diff 01e93a4 HEAD:web
```

**Sửa trong `web/` (phần hồ cá):**
- **Chế độ hình nền** (`?wallpaper`, file mới `src/wallpaper.ts`): ẩn giao diện, lấp đầy màn hình theo đúng tỉ lệ, nhận lệnh từ app desktop qua kênh tin nhắn của WebView2 (gọi cá, tạm dừng, thời tiết, mưa, âm thanh, số cá, fps, khách ghé hồ), và báo lại trạng thái cùng FPS thật mỗi giây. Bản Mac giả lập đúng API `window.chrome.webview` đó nên phần web không có code riêng cho Mac.
- **Đồng bộ cài đặt giữa các cửa sổ** (`src/settings/store.ts`, `persistence.ts`): đổi ở cửa sổ cài đặt thì hình nền đổi theo ngay, qua sự kiện `storage`.
- **Khách ghé hồ** (file mới `ducks.ts`, `crabs.ts`, `shrimp.ts`, `frogs.ts`, `duck-renderer.ts`, `bed-critter-renderer.ts`, `frog-renderer.ts`, `pond-layout.ts`): vịt và vịt con, cua, tôm, ếch, mỗi con có mục cài đặt riêng và thanh trượt "Pond visitors". Vịt va chạm với nhau chứ không chồng lên nhau; được gọi ăn thì vây quanh mồi, mỗi con một chỗ. Vịt mẹ to hơn hẳn vịt con (vịt con chưa bằng nửa). Khi mẹ nghỉ, rỉa lông hay kiếm ăn, vịt con lởn vởn quanh mẹ, mỗi con một chỗ và một hướng ngẫu nhiên, thỉnh thoảng tự kiếm ăn; khi mẹ bơi đi, chúng chờ một chút rồi mới xếp hàng theo sau (mẹ hoảng chạy thì theo ngay). Chỉnh trong **Ducks** (ducklingScale, ducklingSpread, ducklingLinger, ducklingFollowDelay).
- **Vệt rẽ nước sau cá** (`school.ts`): cá bơi sát mặt nước để lại vệt gợn sau lưng giống vịt, càng nông và càng nhanh càng rõ; cá bơi sâu thì không. Bèo và lá sen cũng bị vệt này đẩy. Chỉnh trong **Koi › Wake**.
- **Thời tiết ngẫu nhiên** (file mới `src/weather-cycle.ts`, mục cài đặt **Atmosphere**): đổi sang một thời tiết khác sau mỗi vài phút (mặc định 10, có thể bỏ mưa). Lịch được tính từ đồng hồ nên hồ ở mọi màn hình và cửa sổ cài đặt luôn cùng một thời tiết. Bật bằng mục "Random" trong menu thời tiết, công tắc "Random weather", hoặc menu khay; chọn một thời tiết cụ thể thì chế độ ngẫu nhiên tự tắt.
- **Gợn sóng `wake`** cho vệt nước sau vịt; bèo cũng bị vệt này đẩy (`ripple-system.ts`, `duckweed.ts`).
- **Lá sen bồng bềnh** (file mới `src/lotus-motion.ts`): lá trôi chậm theo dòng nước và nhấp nhô lên xuống; bóng đổ xa/gần theo độ cao. Kích thước lá chỉ đổi rất ít, 0,5–1,5% tuỳ lá, lá càng to càng ít (tỉ lệ nghịch với kích thước). Khi gợn sóng đi qua (bấm, mưa, cá đớp mồi, vệt nước sau vịt), lá bị đẩy dạt ra, nhô lên, xoay nhẹ rồi dập dềnh về chỗ cũ. Ếch đặt chân lên lá thì lá mới bị dìm xuống rồi nảy lên, và ếch nhấp nhô theo lá. Vịt, ếch, bướm và hoa sen đều theo đúng chiếc lá đang dập dềnh. Chỉnh trong **Lotus › Float**.
- **Cá bơi như cá** (`src/school.ts`, `src/koi.ts`): bản gốc để đầu cá quay tự do còn thân bám theo vệt đường đi, cộng sóng lắc dọc cả thân kiểu lươn, nên cá trông như trườn, và khi quay tại chỗ đầu gập ngược sát thân. Giờ:
  - Cá luôn tiến theo hướng đầu, không tự xoay. Muốn quay thì phải bơi tới theo một đường cong, và đường cong không gắt hơn mức thân cá uốn được (tối đa thành chữ C, cá dài cứng hơn nên quay rộng hơn).
  - Thân là một cung tròn theo đúng đường cong đang bơi; độ cong và tốc độ quay thay đổi êm.
  - Sóng bơi kiểu cá: nửa thân trước gần như yên, đuôi quẫy, mỗi nhịp quẫy đẩy cá nhích tới.
  - Đuôi quẫy mạnh hay nhẹ theo tốc độ thật và mức đang tăng tốc (đổi êm), không theo trạng thái: cá chậm chỉ đưa đuôi nhẹ, lúc lướt đuôi gần như yên.
  - Độ cong cho phép tăng dần theo tốc độ (cá chậm gần như không uốn); rẽ thường chỉ dùng phần nhỏ độ cong tối đa và thân chỉ cong theo một phần đường đi, nên vào cua thân vẫn gần thẳng. Chỉ khi lao tới mồi cá mới uốn hết cỡ.
  - Khi dừng, cá vẫn trôi rất chậm, đuôi đưa nhẹ, vây ngực quạt liên tục, giảm tốc êm thay vì phanh gấp.
  - "Xua đàn cá" làm cá lao đi và rẽ ngoặt, không còn quay ngoắt tại chỗ.
  - Chỉnh nhanh trong mục **Koi motion** của bảng cài đặt (độ vẫy đuôi, độ cong thân khi rẽ, độ gắt khi rẽ/quay đầu, chữ C tối đa, độ mượt), chi tiết hơn trong **Koi › Turning** và **Koi › Swimming**.
- **Nhẹ máy hơn, hình vẫn y nguyên**:
  - Khi giới hạn fps (mặc định 30), giữa hai khung hình hồ cá ngủ trên một bộ hẹn giờ rồi mới xin khung hình kế tiếp, thay vì thức dậy theo mọi nhịp quét của màn hình (144–165 Hz) chỉ để bỏ qua (`frame-limiter.ts`, `app.tsx`). Số lần đánh thức trình duyệt giảm khoảng một nửa (126 → 60 lần/giây trên màn 164 Hz), CPU giảm khoảng 25–35%, khung hình còn đều hơn trước.
  - Bóng đổ một màu (lá sen, bèo, vịt, ếch, cua, tôm, bướm, cá nhỏ) được vẽ một lượt thay vì hai lượt mặt sau/mặt trước như three.js mặc định làm với vật thể trong suốt hai mặt; trước đây mỗi khung hình phải tính lại shader cho khoảng 22 lớp bóng (`forceSinglePass`).
  - Hình tròn, elip tính sẵn bảng sin/cos và mỗi điểm viền chỉ tính một lần, không tạo đối tượng tạm; kết quả trùng khớp từng bit với cách cũ (`math.ts`, `surface-geometry.ts`, `fish-renderer.ts`).
  - WebGL xin GPU tiết kiệm điện (`powerPreference: "low-power"`, máy hai GPU sẽ không phải đánh thức card rời) và bỏ bộ đệm độ sâu không dùng tới.
- Nối các phần trên vào `app.tsx`, `school.ts`, `fish-renderer.ts`, `lotus-leaves.ts`, `butterflies.ts`, `settings/definition.ts`, `settings/effects.ts`, `quick-settings.tsx`, `styles.css`, `config.ts`, `surface-geometry.ts`.
- Test mới: `src/pond-visitors.test.ts` (gồm cả lá sen), `src/koi-turning.test.ts`, `src/weather-cycle.test.ts`, và thêm test trong `store.test.ts`, `schema.test.ts`.
- Thêm `package-lock.json` để cài đặt ổn định.

**Mới hoàn toàn (không có trong bản gốc):**
- `app/`: app hình nền Windows (C# .NET 9, WinForms, WebView2) và script `build.ps1`.
- `mac/`: app hình nền macOS (Swift, AppKit, WKWebView), các script `mac/build.sh` và `pack-mac.ps1`.

## Dùng trên Windows

Build trước (xem [Build trên Windows](#build-trên-windows)), rồi chạy `dist\KoiPaper\KoiPaper.exe`. App nằm ở khay hệ thống (icon cá koi cạnh đồng hồ):

| Thao tác | Tác dụng |
|---|---|
| Bấm vào chỗ trống trên desktop | Gọi cá bơi tới chỗ đó |
| Bấm trái vào icon ở khay | Mở **cài đặt hồ cá** (giao diện Nagomi đầy đủ; mọi thay đổi áp dụng ngay lên hình nền) |
| Bấm phải vào icon ở khay | Thời tiết (kể cả **Ngẫu nhiên**), mưa, âm thanh dòng nước, số cá, **khách ghé hồ** (bật/tắt vịt, cua, tôm, ếch), fps, xua đàn cá, tạm dừng, chọn màn hình, khởi động cùng Windows, thoát |
| Chạy lại `KoiPaper.exe` khi đang chạy | Mở cửa sổ cài đặt (chỉ chạy một bản) |
| Menu khay → **Tài nguyên đang dùng…** (hoặc `KoiPaper.exe --resources`) | Xem trực tiếp CPU, RAM, GPU, VRAM của app và từng tiến trình WebView2, biểu đồ 2 phút, FPS thật của hồ cá và lý do đang tạm dừng (nếu có) |

Tự động:
- **Tự dừng** khi một cửa sổ phóng to hoặc app toàn màn hình (game, phim) che kín màn hình, hay khi khoá máy, để không tốn GPU/CPU. Tắt được trong menu. Trong lúc dừng, hồ cá trả bớt bộ nhớ cho Windows (bộ nhớ riêng của tiến trình vẽ giảm khoảng 30 MB) và app gỡ hook chuột toàn hệ thống, nên khi chơi game mỗi cú di chuột không còn phải đi qua Koi Paper.
- Mặc định chạy **30 fps** (khoảng 1–2% CPU trên máy 12 luồng); đổi trong menu "Tốc độ khung hình".
- Mỗi màn hình có một hồ riêng; âm thanh chỉ phát ở màn hình chính.
- Explorer khởi động lại, đổi độ phân giải hoặc cắm/rút màn hình thì hình nền tự dựng lại.
- Thoát (hoặc app bị tắt ngang) thì desktop trở về hình nền cũ.

Cài đặt của app nằm ở `%LOCALAPPDATA%\KoiPaper\settings.json`, log ở `%LOCALAPPDATA%\KoiPaper\koipaper.log`.

### Khách ghé hồ

Ngoài cá koi, hồ còn có:

- **Vịt**: một vịt trắng dẫn 4 vịt con và một vịt trời đầu xanh. Vịt bơi trên mặt nước, có bóng đổ xuống đáy, để lại vệt sóng đẩy cả bèo, và né lá sen. Thỉnh thoảng chúng nghỉ, rỉa lông hoặc chúi đầu kiếm ăn. **Bấm gần vịt thì vịt bơi tới như được cho ăn.**
- **Cua**: bò ngang dưới đáy hồ, nhặt thức ăn bằng càng, thỉnh thoảng giơ càng vẫy. Bấm gần thì cua chạy ngang.
- **Tôm**: lững thững kiếm ăn dưới đáy. Bị dọa thì quay mặt về phía mối nguy rồi búng đuôi giật lùi ra xa, như tôm thật.
- **Ếch**: ngồi trên lá sen, phồng họng kêu, nhảy sang lá khác hoặc nhảy tõm xuống nước rồi đạp chân bơi về lá. Bấm gần thì ếch nhảy xuống nước trốn.

"Xua đàn cá" làm tất cả cùng giật mình. Đổi số lượng trong **Cài đặt hồ cá → Pond visitors**. Phần nâng cao cùng tên chỉnh được tốc độ, màu sắc, tần suất; muốn đổi số vịt con của mỗi vịt mẹ thì vào **Duck spawns**.

## Dùng trên macOS (bản cá nhân, chạy local)

Bản Mac nằm trong `mac/`: app thanh menu (icon con cá cạnh đồng hồ, không có icon ở Dock) viết bằng Swift + WKWebView, dùng chung hồ cá trong `web/`. Có đủ các mục như menu khay Windows, kể cả **Tài nguyên đang dùng…** (CPU và bộ nhớ của app cùng các tiến trình WebKit, đo giống Activity Monitor). App được ký ad-hoc, chỉ để chạy trên máy tự build.

```bash
xcode-select --install          # chỉ cần nếu Mac chưa có trình biên dịch Swift
git clone https://github.com/DaydreamerSY/koi-pond.git
cd koi-pond
bash mac/build.sh
open "dist-mac/Koi Paper.app"
```

`mac/build.sh` build cả phần hồ cá (`web/`) rồi đến app. Nếu Mac chưa có Node.js, script tự tải Node từ nodejs.org vào thư mục `.cache/` của repo (có kiểm tra SHA-256, không cài gì vào hệ thống). Nên chép `Koi Paper.app` vào **Applications** nếu muốn bật "Mở cùng macOS".

Không có git trên Mac? Trên Windows chạy `.\build.ps1` rồi `.\pack-mac.ps1` để tạo `dist\KoiPaper-mac.zip`, chép sang Mac, giải nén rồi chạy `bash mac/build.sh`.

Lưu ý riêng cho Mac:
- Bấm vào desktop để gọi cá: app chỉ theo dõi cú click chuột, không đọc bàn phím, nên không cần cấp quyền gì. Với nhiều màn hình, click được tính theo màn hình đang có con trỏ; chỉ cửa sổ thật (app, Dock, thanh menu) mới chặn click, còn mọi lớp thuộc desktop (hình nền, icon, widget) thì không.
- Nếu bật "Click wallpaper to reveal desktop" (System Settings › Desktop & Dock), mỗi lần bấm desktop các cửa sổ sẽ dạt sang bên; cá vẫn bơi tới chỗ bấm.
- Cài đặt của app: `defaults read local.koipaper`.
- Đã build và chạy tốt trên MacBook Pro M2, macOS Tahoe 26.6.2.

## Build trên Windows

Cần [.NET 9 SDK](https://dotnet.microsoft.com/download) và [Node.js](https://nodejs.org) 20 trở lên (`winget install OpenJS.NodeJS.LTS`). WebView2 Runtime có sẵn trên Windows 11.

```powershell
.\build.ps1                 # build web\ rồi app\ vào dist\KoiPaper
.\build.ps1 -SkipWeb        # dùng lại web\dist đã build
.\build.ps1 -SelfContained  # gói kèm .NET, để chạy trên máy chưa cài .NET 9
```

## Cấu trúc

```
web/   Nagomi (lịch sử commit gốc) + các thay đổi ở trên
app/   app Windows: C# .NET 9, WinForms, WebView2
mac/   app macOS: Swift, AppKit, WKWebView
```

Lấy bản Nagomi mới từ repo gốc (có thể phải gộp xung đột với các thay đổi ở trên):

```bash
git subtree pull --prefix=web https://github.com/msk1039/nagomi.git main
```

**`app/`** (Windows):
- `DesktopHost.cs`: tìm chỗ sau icon desktop. Windows 11 24H2 trở lên đặt cửa sổ (dạng layered) vào `Progman`, giữa `SHELLDLL_DefView` (icon) và `WorkerW` (hình nền của Explorer); Windows cũ hơn dùng `WorkerW` cấp cao nhất kiểu truyền thống.
- `WallpaperWindow.cs`: mỗi màn hình một cửa sổ Win32 chứa WebView2, nạp `wwwroot` qua host ảo `https://koipaper.example`.
- `DesktopClickHook.cs`: hook chuột cấp thấp; cửa sổ sau icon không nhận được click nên click trên desktop được chuyển vào hồ cá.
- `Occlusion.cs`: phát hiện màn hình bị che kín để tự dừng.
- `ResourceSampler.cs`, `ResourceForm.cs`: cửa sổ tài nguyên (CPU, RAM, GPU, VRAM theo từng tiến trình).
- `TrayApp.cs`: icon khay, menu, vòng đời; `SettingsForm.cs`: cửa sổ cài đặt.

**`mac/`** (macOS):
- `Wallpaper.swift`: mỗi màn hình một cửa sổ ở tầng ảnh nền desktop (dưới icon, có mặt ở mọi Space).
- `PondWeb.swift`: phục vụ `web/dist` qua `koipaper://app/` và giả lập API WebView2 cho phần web.
- `DesktopProbe.swift`: nhận biết click trên desktop và màn hình bị che kín, dựa vào danh sách cửa sổ của macOS.
- `ResourceMonitor.swift`: cửa sổ tài nguyên. `AppDelegate.swift`: menu, vòng đời, cửa sổ cài đặt.

## Giới hạn đã biết

- Bản Windows đã chạy thử trên Windows 11 25H2 với một màn hình. Nhiều màn hình và nhánh Windows 10 / Windows 11 trước 24H2 đã được viết nhưng **chưa chạy thử**.
- Bản macOS đã chạy tốt trên MacBook Pro M2 (macOS Tahoe 26.6.2); máy Mac Intel và macOS cũ hơn chưa chạy thử.
- Bấm lên icon desktop cũng gọi cá tới đó (không phân biệt icon với chỗ trống).
