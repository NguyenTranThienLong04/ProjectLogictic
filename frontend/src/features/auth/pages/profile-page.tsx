import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { ErrorState } from '../../../components/ui/error-state';
import { FormField } from '../../../components/ui/form-field';
import { LoadingState } from '../../../components/ui/loading-state';
import { PageHeader } from '../../../components/ui/page-header';
import { getApiErrorMessage } from '../../../services/api-error';
import type { UserRole } from '../../../types/auth';
import { getProfile, updateProfile } from '../auth-api';
import { useAuth } from '../auth-context';
import { AccountLayout } from '../components/account-layout';

const roleLabels: Record<UserRole, string> = {
  CUSTOMER: 'Khách hàng',
  DRIVER: 'Tài xế',
  WAREHOUSE_STAFF: 'Nhân viên kho',
  DISPATCHER: 'Điều phối viên',
  ADMIN: 'Quản trị viên',
};
const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;
const schema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên cần ít nhất 2 ký tự').max(100),
  phone: z
    .string()
    .trim()
    .refine((value) => !value || phonePattern.test(value), 'Số điện thoại không đúng định dạng'),
});
type ProfileForm = z.infer<typeof schema>;

export function ProfilePage() {
  const queryClient = useQueryClient();
  const { updateUser } = useAuth();
  const [successMessage, setSuccessMessage] = useState<string>();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const { formState, handleSubmit, register, reset } = useForm<ProfileForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });
  const updateMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => {
      updateUser(user);
      queryClient.setQueryData(['profile'], user);
      setSuccessMessage('Hồ sơ đã được cập nhật.');
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      reset({ fullName: profileQuery.data.fullName, phone: profileQuery.data.phone ?? '' });
    }
  }, [profileQuery.data, reset]);

  const submit = handleSubmit(({ fullName, phone }) => {
    setSuccessMessage(undefined);
    updateMutation.mutate({ fullName, phone: phone || null });
  });

  if (profileQuery.isPending) return <LoadingState label="Đang tải hồ sơ" />;

  return (
    <AccountLayout>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          description="Kiểm tra thông tin định danh và cập nhật thông tin liên hệ."
          eyebrow="Tài khoản"
          title="Hồ sơ của tôi"
        />

        {profileQuery.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(profileQuery.error)}
              onRetry={() => profileQuery.refetch()}
              title="Không thể tải hồ sơ"
            />
          </div>
        ) : profileQuery.data ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.65fr] lg:gap-6">
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6 lg:p-8">
              <h2 className="text-lg font-semibold text-ink sm:text-xl">Thông tin liên hệ</h2>
              <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
                <ErrorSummary
                  message={
                    updateMutation.isError ? getApiErrorMessage(updateMutation.error) : undefined
                  }
                />
                {successMessage ? (
                  <p
                    aria-live="polite"
                    className="rounded-control border border-success/30 bg-success-soft p-4 text-sm font-medium text-success"
                  >
                    {successMessage}
                  </p>
                ) : null}
                <FormField
                  autoComplete="name"
                  error={formState.errors.fullName?.message}
                  id="profile-name"
                  label="Họ và tên"
                  {...register('fullName')}
                />
                <FormField
                  autoComplete="tel"
                  error={formState.errors.phone?.message}
                  id="profile-phone"
                  label="Số điện thoại"
                  type="tel"
                  {...register('phone')}
                />
                <Button className="w-full sm:w-auto" loading={updateMutation.isPending} type="submit">
                  Lưu thay đổi
                </Button>
              </form>
            </section>

            <aside className="rounded-surface border border-border-strong bg-primary-soft p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-ink">Thông tin tài khoản</h2>
              <dl className="mt-5 space-y-5 text-base">
                <div>
                  <dt className="font-medium text-muted-foreground">Email</dt>
                  <dd className="mt-1 break-words font-semibold text-ink">{profileQuery.data.email}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Vai trò</dt>
                  <dd className="mt-1 font-semibold text-ink">{roleLabels[profileQuery.data.role]}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Trạng thái</dt>
                  <dd className="mt-1 inline-flex items-center gap-2 font-semibold text-success">
                    <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                    Đang hoạt động
                  </dd>
                </div>
              </dl>
              <Link
                className="focus-ring ui-transition mt-7 inline-flex min-h-12 touch-manipulation items-center rounded-control text-base font-semibold text-primary hover:text-primary-strong"
                to="/change-password"
              >
                Đổi mật khẩu
              </Link>
            </aside>
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState
              description="Thông tin tài khoản chưa sẵn sàng. Hãy thử tải lại trang."
              title="Chưa có dữ liệu hồ sơ"
            />
          </div>
        )}
      </div>
    </AccountLayout>
  );
}
