import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { PasswordField } from '../../../components/ui/password-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { changePassword } from '../auth-api';
import { useAuth } from '../auth-context';
import { AuthLayout } from '../components/auth-layout';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: z.string().min(12, 'Mật khẩu cần ít nhất 12 ký tự').max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    path: ['newPassword'],
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });
type ChangePasswordForm = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string>();
  const { formState, handleSubmit, register } = useForm<ChangePasswordForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setServerError(undefined);
    try {
      const message = await changePassword(currentPassword, newPassword);
      try {
        await logout();
      } catch {
        // The password change already revoked every session; local logout still clears auth state.
      }
      navigate('/login', { replace: true, state: { notice: message } });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AuthLayout
      description={
        user?.mustChangePassword
          ? 'Đây là mật khẩu tạm thời. Bạn cần đổi mật khẩu trước khi tiếp tục.'
          : 'Đổi mật khẩu sẽ đăng xuất tất cả phiên đang hoạt động để bảo vệ tài khoản.'
      }
      eyebrow={user?.mustChangePassword ? 'Yêu cầu bảo mật' : 'Bảo mật tài khoản'}
      title="Đổi mật khẩu"
    >
      <form className="space-y-5" noValidate onSubmit={submit}>
        <ErrorSummary message={serverError} />
        <PasswordField
          autoComplete="current-password"
          error={formState.errors.currentPassword?.message}
          id="current-password"
          label="Mật khẩu hiện tại"
          {...register('currentPassword')}
        />
        <PasswordField
          autoComplete="new-password"
          error={formState.errors.newPassword?.message}
          helperText="Tối thiểu 12 ký tự và khác mật khẩu hiện tại."
          id="new-password"
          label="Mật khẩu mới"
          {...register('newPassword')}
        />
        <PasswordField
          autoComplete="new-password"
          error={formState.errors.confirmPassword?.message}
          id="confirm-new-password"
          label="Xác nhận mật khẩu mới"
          {...register('confirmPassword')}
        />
        <Button className="w-full" loading={formState.isSubmitting} type="submit">
          Đổi mật khẩu và đăng xuất
        </Button>
      </form>
    </AuthLayout>
  );
}
