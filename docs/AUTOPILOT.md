# AUTOPILOT — Chế Độ Tự Chạy Liên Tục Theo Roadmap

> Chỉ nạp file này khi user yêu cầu chạy autopilot (vd: "chạy autopilot phase 3",
> "tự cày hết phase hiện tại"). Bình thường KHÔNG đọc file này.
> Vẫn phải tuân thủ AI.md + docs/CONSTITUTION.md + docs/TESTING.md như mọi lúc —
> file này chỉ thêm vòng lặp điều khiển, không thay thế rule nghiệp vụ.

---

## 1. KHỞI ĐỘNG

1. Đọc `AI.md` + `PROJECT_STATE.md`.
2. Xác định **phase mục tiêu** (user chỉ định, hoặc lấy đúng phase ghi trong
   `PROJECT_STATE.md → Current Phase`).
3. Đọc `docs/ROADMAP.md` → lấy danh sách hạng mục (task) của phase đó.
4. So với `PROJECT_STATE.md → Completed` → suy ra **task queue** còn lại của phase này.
5. Nếu queue rỗng (phase đã xong hết) → DỪNG, báo cáo, hỏi user có muốn sang phase kế không.
   **Không tự nhảy phase.**

---

## 2. VÒNG LẶP (lặp cho từng task trong queue)

Với mỗi task:

```
a. Đọc docs/*.md liên quan (theo bảng routing trong AI.md)
b. Inspect code liên quan (không quét toàn repo)
c. Xác định invariant / rule bị ảnh hưởng (C01-C18)
d. Implement backend trước
e. Viết/chạy test cho task đó (docs/TESTING.md)
   → test fail = task CHƯA xong, không chuyển task tiếp theo, tự sửa và chạy lại
f. Implement frontend (theo guideline docs/UI.md nếu có UI)
g. Chạy typecheck + build cho phần vừa đổi
h. Cập nhật PROJECT_STATE.md (thêm vào Completed, xoá khỏi In Progress)
i. Report ngắn 1 task: file changed / rule enforced / test result
j. Tự động chuyển sang task tiếp theo trong queue — KHÔNG chờ user xác nhận
```

Không dừng để hỏi "có muốn tiếp tục không" sau mỗi task nhỏ — chỉ report rồi đi tiếp.

---

## 3. ĐIỀU KIỆN PHẢI DỪNG LẠI VÀ HỎI USER

Dừng vòng lặp ngay, giải thích lý do, chờ user quyết định nếu gặp:

```
- Hết task trong phase hiện tại (ranh giới phase)
- Yêu cầu đổi Prisma schema theo cách phá vỡ dữ liệu hiện có (drop column có data,
  đổi kiểu không tương thích...)
- Quyết định nghiệp vụ chưa rõ trong AI.md/docs/ (vd: chính sách phí COD cụ thể,
  giá trị mặc định business chưa định nghĩa)
- Cần credential/secret thật (API key bên thứ 3, production DB...)
- Test bắt buộc (docs/TESTING.md) fail liên tục sau khi đã tự sửa >=2 lần
- Phát hiện code hiện tại vi phạm invariant ở FINAL SYSTEM INVARIANT (AI.md §4)
  theo cách ảnh hưởng phạm vi rộng hơn task đang làm
- Task yêu cầu xoá cứng (hard delete) dữ liệu thuộc nhóm C05
```

Không tự ý "đoán" nghiệp vụ để né dừng lại — thà dừng và hỏi còn hơn tự bịa rule.

---

## 4. BÁO CÁO CUỐI PHIÊN (khi dừng hẳn — hết queue hoặc gặp điều kiện dừng)

```md
## Autopilot Report — Phase X
### Done trong phiên này
- task, files, rule enforced, test status

### Blocked / cần user quyết định
- lý do dừng cụ thể (theo mục 3)

### PROJECT_STATE.md
- đã cập nhật: có/không
```

---

## 5. GIỚI HẠN AN TOÀN

- Không tự chạy migration lên môi trường production.
- Không tự xoá/sửa test để "cho qua" — nếu test sai so với rule mới, phải nêu rõ
  và hỏi trước khi sửa test.
- Không tự thêm dependency/package ngoài stack cố định (STACK.md) mà không báo.
- Mỗi lần dừng lại đều phải để lại `PROJECT_STATE.md` ở trạng thái sạch, agent
  (hoặc người) kế tiếp đọc vào là biết ngay đang ở đâu.
