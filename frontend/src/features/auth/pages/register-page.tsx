import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { PasswordField } from '../../../components/ui/password-field';
import { getApiErrorMessage } from '../../../services/api-error';
import { useAuth } from '../auth-context';
import { AuthLayout } from '../components/auth-layout';

const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;
const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Họ tên cần ít nhất 2 ký tự').max(100),
    email: z.email('Email không đúng định dạng'),
    phone: z
      .string()
      .trim()
      .refine((value) => !value || phonePattern.test(value), 'Số điện thoại không đúng định dạng'),
    password: z.string().min(12, 'Mật khẩu cần ít nhất 12 ký tự').max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof schema>;

export function RegisterPage() {
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string>();
  const { formState, handleSubmit, register } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { phone: '' },
  });

  const submit = handleSubmit(async (values) => {
    setServerError(undefined);
    try {
      await registerAccount({
        email: values.email,
        fullName: values.fullName,
        password: values.password,
        phone: values.phone || undefined,
      });
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  });

  return (
    <AuthLayout
      eyebrow="Tài khoản khách hàng"
      title="Bắt đầu vận chuyển"
      description="Tạo tài khoản để quản lý vận đơn và theo dõi hành trình ở một nơi."
    >
      <form className="space-y-5" noValidate onSubmit={submit}>
        <ErrorSummary message={serverError} />
        <FormField
          autoComplete="name"
          error={formState.errors.fullName?.message}
          id="register-name"
          label="Họ và tên"
          {...register('fullName')}
        />
        <FormField
          autoComplete="email"
          error={formState.errors.email?.message}
          id="register-email"
          label="Email"
          type="email"
          {...register('email')}
        />
        <FormField
          autoComplete="tel"
          error={formState.errors.phone?.message}
          helperText="Không bắt buộc. Ví dụ: +84 901 234 567"
          id="register-phone"
          label="Số điện thoại"
          type="tel"
          {...register('phone')}
        />
        <PasswordField
          autoComplete="new-password"
          error={formState.errors.password?.message}
          helperText="Tối thiểu 12 ký tự. Bạn có thể dùng trình quản lý mật khẩu và dán mật khẩu."
          id="register-password"
          label="Mật khẩu"
          {...register('password')}
        />
        <PasswordField
          autoComplete="new-password"
          error={formState.errors.confirmPassword?.message}
          id="register-confirm-password"
          label="Xác nhận mật khẩu"
          {...register('confirmPassword')}
        />
        <Button className="w-full" loading={formState.isSubmitting} type="submit">
          Tạo tài khoản
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-muted-foreground">
        Đã có tài khoản?{' '}
        <Link
          className="focus-ring rounded font-bold text-primary hover:text-primary-strong"
          to="/login"
        >
          Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
