[English](README.md) | **Tiếng Việt**

# MCP-GenSubTask

MCP server + Claude Code skill giúp tạo và đồng bộ subtask với hệ thống PM Alliance ITSC trong khi công
việc triển khai diễn ra ở local.

> **Lưu ý (dành cho AI agent & clone mới):** sau khi `git clone`/`git pull`, dependencies không được cài
> tự động — chạy `npm install` trước khi chạy server, test, hoặc bất kỳ script nào trong repo này.

## Cài đặt

1. `npm install`
2. Đặt `PM_API_KEY` (và tuỳ chọn `PM_API_URL`, mặc định là `https://pm-api.allianceitsc.com`) trong
   environment, hoặc để tool `pm_setup` hỏi khi dùng lần đầu — key sau đó được lưu vào
   `.pm-sync-config.json` trong thư mục project gọi tool (đã gitignore).
3. Cài như một Claude Code plugin — repo này tự đóng vai trò marketplace của chính nó
   (`.claude-plugin/marketplace.json`):
   - CLI: `/plugin marketplace add hungngominh/GenSubtaskPM` rồi `/plugin install pm-gensubtask@gensubtask-pm`
   - VS Code extension: gõ `/plugins`, mở tab **Marketplaces**, add `hungngominh/GenSubtaskPM`, sau đó
     cài `pm-gensubtask` từ tab **Plugins** (`/plugin install` là lệnh CLI, chưa được đăng ký trong
     VS Code extension)

   File `.mcp.json` đi kèm dùng `${CLAUDE_PLUGIN_ROOT}` nên đường dẫn server tự resolve theo nơi plugin
   được cài — không cần sửa đường dẫn tuyệt đối.

### Cập nhật

Client đã cài **không** tự động pull commit mới được push lên repo này (auto-update mặc định tắt với
marketplace tự host). Sau khi push code mới, mỗi client cần chạy:

```
/plugin marketplace update gensubtask-pm
```

rồi `/reload-plugins` (hoặc restart Claude Code) để nạp code mới. Muốn việc này tự động, bật auto-update
cho marketplace qua `/plugin` → tab **Marketplaces** → `gensubtask-pm` → **Enable auto-update**.

### Cài đặt nhanh cho project khác (máy client)

Để nối một project *khác* vào cùng MCP server này (không cần copy code — nó trỏ tới `mcp/server.js` của
repo này theo đường dẫn tuyệt đối):

```
node scripts/setup-client.js <path-to-target-project>
```

Lệnh này tạo/merge `.mcp.json` trong project đích và thêm các file PM-sync vào `.gitignore` của project
đó. Nó không đụng vào API key — sau khi chạy xong, mở một session Claude Code trong project đích và chạy
`pm_setup` để nhập và xác thực `PM_API_KEY` (tránh lộ key trong lịch sử shell/log).

## Các tool

| Tool | Mục đích |
|---|---|
| `pm_setup` | Xác định và validate `PM_API_KEY` với hệ thống PM. |
| `pm_create_parent_task` | Tạo task cấp cao nhất (task cha), không có `parent_task_id`, chống trùng theo title. Các field optional ngoài `title`/`description`/`workstream`/`layer`/`assignee_id`: `due_date`, `estimate_hours`, `priority`, `status_code`, `size`, `difficulty`, `impact`, `is_notify_task`, `link_slide` — chỉ set khi operator yêu cầu rõ ràng giá trị đó. |
| `pm_create_subtasks` | Tạo các subtask PM dưới một task cha, chống trùng. Agent nên tra `assignee_id` qua `pm_list_members` và hỏi operator, chỉ để trống khi operator chủ động từ chối gán. Cùng các field optional như `pm_create_parent_task`, set riêng theo từng subtask. |
| `pm_start_subtask` | Đánh dấu subtask DOING + ghi log checklist "Started-at". |
| `pm_complete_subtask` | Đánh dấu subtask DONE ở 100% + ghi log checklist "Completed-at". Yêu cầu `actual_hours` (số giờ làm kể từ lần cập nhật trước); giá trị này được cộng dồn vào tổng hiện có, không ghi đè. |
| `pm_update_progress` | Cập nhật `progress_percent` / `status_code` giữa chừng task. Yêu cầu `actual_hours` (số giờ làm kể từ lần cập nhật trước); giá trị này được cộng dồn vào tổng hiện có, không ghi đè. |
| `pm_audit_status` | Chỉ đọc — đối chiếu trạng thái đồng bộ local với hệ thống PM thật. |
| `pm_list_members` | Liệt kê thành viên project kèm `user_id`/roles, dùng để tra `assignee_id`. |
| `pm_get_task` | Chỉ đọc — tra chi tiết 1 task theo id: status, assignee, progress, số giờ, task cha liên kết. |
| `pm_list_tasks` | Chỉ đọc — liệt kê toàn bộ task cấp cao nhất đang active trong project, kèm title các subtask. |
| `pm_add_checklist_items` | Thêm một hoặc nhiều checklist item (bước phụ nhẹ/mục cần verify) vào một task đã tồn tại. Chỉ tạo mới — không có get/update/delete cho checklist item. |

Lưu ý: `assignee_id` và các field khác của task (`title`, `description`, `workstream`, v.v.) không thể sửa
lại trên một task đã tồn tại — endpoint `PATCH tasks/:taskId` của PM API chỉ chấp nhận `status_code`,
`actual_hours`, và `progress_percent` (xem `bot_tasks.md` §2.6, §3). Không có endpoint để reassign/đổi
tên/xoá task.

## Skill

`skills/pm-synced-development/SKILL.md` — dùng thay cho `subagent-driven-development` của superpowers khi
bạn muốn việc đồng bộ board PM được lồng vào cùng vòng lặp per-task.

## Testing

- `npm test` — unit test, tầng HTTP đã mock, không gọi API thật.
- `node scripts/manual-e2e.js <parent_task_id> <assignee_id>` — verify thủ công/live với API PM thật. Cần
  `PM_API_KEY` thật, `parent_task_id` thật, và `assignee_id` thật (dùng `pm_list_members` để tìm). Không
  chạy trong CI.

## State

`.pm-sync-state.json` (đã gitignore) trong thư mục project gọi tool lưu mapping title → PM task id dùng
cho việc chống trùng và audit. Xoá an toàn — các subtask sẽ tự động được kiểm tra lại với hệ thống PM thật
ở lần gọi `pm_create_subtasks` kế tiếp.
