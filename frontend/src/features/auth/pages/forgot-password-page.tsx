import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { forgotPassword } from '../auth-api';
import { AuthLayout } from '../components/auth-layout';

const schema = z.object({ email: z.email('Email không đúng định dạng') });
type ForgotPasswordForm = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [serverError, setServerError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const { formState, handleSubmit, register } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  const submit = handleSubmit(async ({ email }) => {
    setServerError(undefined);
    setSuccessMessage(undefined);
    try {
      setSuccessMessage(await forgotPassword(email));
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AuthLayout
      description="Nhập email tài khoản. Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến bạn."
      eyebrow="Khôi phục truy cập"
      title="Quên mật khẩu"
    >
      {successMessage ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"
        >
          {successMessage}
        </div>
      ) : (
        <form className="space-y-5" noValidate onSubmit={submit}>
          <ErrorSummary message={serverError} />
          <FormField
            autoComplete="email"
            error={formState.errors.email?.message}
            id="forgot-email"
            label="Email"
            placeholder="name@company.com"
            type="email"
            {...register('email')}
          />
          <Button className="w-full" loading={formState.isSubmitting} type="submit">
            Gửi hướng dẫn
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
