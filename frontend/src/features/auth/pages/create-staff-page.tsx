import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { PageHeader } from '../../../components/ui/page-header';
import { PasswordField } from '../../../components/ui/password-field';
import { SelectField } from '../../../components/ui/select-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { createStaff } from '../auth-api';
import { AccountLayout } from '../components/account-layout';

const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;
const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Họ tên cần ít nhất 2 ký tự').max(100),
    email: z.email('Email không đúng định dạng'),
    phone: z
      .string()
      .trim()
      .refine((value) => !value || phonePattern.test(value), 'Số điện thoại không đúng định dạng'),
    role: z.enum(['DRIVER', 'WAREHOUSE_STAFF', 'DISPATCHER', 'ADMIN']),
    temporaryPassword: z.string().min(12, 'Mật khẩu tạm cần ít nhất 12 ký tự').max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.temporaryPassword === values.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });
type CreateStaffForm = z.infer<typeof schema>;

export function CreateStaffPage() {
  const [serverError, setServerError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const { formState, handleSubmit, register, reset } = useForm<CreateStaffForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { phone: '', role: 'DRIVER' },
  });

  const submit = handleSubmit(async (values) => {
    setServerError(undefined);
    setSuccessMessage(undefined);
    try {
      const user = await createStaff({
        email: values.email,
        fullName: values.fullName,
        phone: values.phone || undefined,
        role: values.role,
        temporaryPassword: values.temporaryPassword,
      });
      setSuccessMessage(
        `Đã tạo tài khoản ${user.email}. Người dùng phải đổi mật khẩu khi đăng nhập lần đầu.`,
      );
      reset({
        fullName: '',
        email: '',
        phone: '',
        role: 'DRIVER',
        temporaryPassword: '',
        confirmPassword: '',
      });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AccountLayout>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          description="Chỉ quản trị viên có thể cấp tài khoản nội bộ. Mật khẩu tạm thời bắt buộc được đổi ở lần đăng nhập đầu tiên."
          eyebrow="Quản trị truy cập"
          title="Tạo tài khoản nhân viên"
        />
        <section className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
          <form className="space-y-5" noValidate onSubmit={submit}>
            <ErrorSummary message={serverError} />
            {successMessage ? (
              <p
                aria-live="polite"
                className="rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900"
              >
                {successMessage}
              </p>
            ) : null}
            <FormField
              autoComplete="name"
              error={formState.errors.fullName?.message}
              id="staff-name"
              label="Họ và tên"
              {...register('fullName')}
            />
            <FormField
              autoComplete="email"
              error={formState.errors.email?.message}
              id="staff-email"
              label="Email công việc"
              type="email"
              {...register('email')}
            />
            <FormField
              autoComplete="tel"
              error={formState.errors.phone?.message}
              id="staff-phone"
              label="Số điện thoại"
              type="tel"
              {...register('phone')}
            />
            <SelectField
              error={formState.errors.role?.message}
              id="staff-role"
              label="Vai trò"
              {...register('role')}
            >
              <option value="DRIVER">Tài xế</option>
              <option value="WAREHOUSE_STAFF">Nhân viên kho</option>
              <option value="DISPATCHER">Điều phối viên</option>
              <option value="ADMIN">Quản trị viên</option>
            </SelectField>
            <PasswordField
              autoComplete="new-password"
              error={formState.errors.temporaryPassword?.message}
              helperText="Tối thiểu 12 ký tự; gửi qua kênh bảo mật cho người nhận."
              id="staff-password"
              label="Mật khẩu tạm thời"
              {...register('temporaryPassword')}
            />
            <PasswordField
              autoComplete="new-password"
              error={formState.errors.confirmPassword?.message}
              id="staff-confirm-password"
              label="Xác nhận mật khẩu tạm"
              {...register('confirmPassword')}
            />
            <Button className="w-full sm:w-auto" loading={formState.isSubmitting} type="submit">
              Tạo tài khoản
            </Button>
          </form>
        </section>
      </div>
    </AccountLayout>
  );
}
