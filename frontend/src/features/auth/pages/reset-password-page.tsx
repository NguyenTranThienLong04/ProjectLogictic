import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { PasswordField } from '../../../components/ui/password-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { resetPassword } from '../auth-api';
import { AuthLayout } from '../components/auth-layout';

const schema = z
  .object({
    password: z.string().min(12, 'Mật khẩu cần ít nhất 12 ký tự').max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });
type ResetPasswordForm = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [serverError, setServerError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const { formState, handleSubmit, register } = useForm<ResetPasswordForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  const submit = handleSubmit(async ({ password }) => {
    if (!token) return;
    setServerError(undefined);
    try {
      setSuccessMessage(await resetPassword(token, password));
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AuthLayout
      description="Chọn mật khẩu mới đủ mạnh và không dùng lại mật khẩu cũ."
      eyebrow="Khôi phục truy cập"
      title="Đặt lại mật khẩu"
    >
      {!token ? (
        <ErrorSummary message="Liên kết đặt lại mật khẩu không hợp lệ hoặc thiếu token." />
      ) : successMessage ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"
        >
          {successMessage}
        </div>
      ) : (
        <form className="space-y-5" noValidate onSubmit={submit}>
          <ErrorSummary message={serverError} />
          <PasswordField
            autoComplete="new-password"
            error={formState.errors.password?.message}
            helperText="Tối thiểu 12 ký tự. Cho phép dán từ trình quản lý mật khẩu."
            id="reset-password"
            label="Mật khẩu mới"
            {...register('password')}
          />
          <PasswordField
            autoComplete="new-password"
            error={formState.errors.confirmPassword?.message}
            id="reset-confirm-password"
            label="Xác nhận mật khẩu mới"
            {...register('confirmPassword')}
          />
          <Button className="w-full" loading={formState.isSubmitting} type="submit">
            Đặt lại mật khẩu
          </Button>
        </form>
      )}
      <p className="mt-7 text-center text-sm text-muted-foreground">
        <Link
          className="focus-ring rounded font-bold text-primary hover:text-primary-strong"
          to="/login"
        >
          Quay lại đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
