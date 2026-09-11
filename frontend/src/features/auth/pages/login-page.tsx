import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { PasswordField } from '../../../components/ui/password-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { useAuth } from '../auth-context';
import { AuthLayout } from '../components/auth-layout';

const schema = z.object({
  email: z.email('Email không đúng định dạng'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type LoginForm = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const [serverError, setServerError] = useState<string>();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const { formState, handleSubmit, register } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  const submit = handleSubmit(async (values) => {
    setServerError(undefined);
    try {
      await login(values);
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AuthLayout
      eyebrow="Chào mừng trở lại"
      title="Đăng nhập"
      description="Truy cập đúng không gian làm việc theo vai trò của bạn."
    >
      <form className="space-y-5" noValidate onSubmit={submit}>
        {notice ? (
          <p
            aria-live="polite"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"
          >
            {notice}
          </p>
        ) : null}
        <ErrorSummary message={serverError} />
        <FormField
          autoComplete="email"
          error={formState.errors.email?.message}
          id="login-email"
          label="Email"
          placeholder="name@company.com"
          type="email"
          {...register('email')}
        />
        <div>
          <PasswordField
            autoComplete="current-password"
            error={formState.errors.password?.message}
            id="login-password"
            label="Mật khẩu"
            {...register('password')}
          />
          <div className="mt-3 text-right">
            <Link
              className="focus-ring rounded text-sm font-bold text-primary hover:text-primary-strong"
              to="/forgot-password"
            >
              Quên mật khẩu?
            </Link>
          </div>
        </div>
        <Button className="w-full" loading={formState.isSubmitting} type="submit">
          Đăng nhập
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-muted-foreground">
        Chưa có tài khoản?{' '}
        <Link
          className="focus-ring rounded font-bold text-primary hover:text-primary-strong"
          to="/register"
        >
          Đăng ký khách hàng
        </Link>
      </p>
    </AuthLayout>
  );
}
