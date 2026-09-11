import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { AccountLayout } from '../auth/components/account-layout';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  type Address,
  type AddressInput,
} from './address-api';

const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;
const addressSchema = z.object({
  label: z.string().trim().min(1, 'Nhập tên gợi nhớ').max(50, 'Tối đa 50 ký tự'),
  contactName: z.string().trim().min(2, 'Tên liên hệ cần ít nhất 2 ký tự').max(100),
  phone: z.string().trim().regex(phonePattern, 'Số điện thoại không đúng định dạng'),
  streetAddress: z.string().trim().min(3, 'Địa chỉ cần ít nhất 3 ký tự').max(255),
  ward: z.string().trim().min(2, 'Nhập phường/xã').max(100),
  district: z.string().trim().min(2, 'Nhập quận/huyện').max(100),
  city: z.string().trim().min(2, 'Nhập tỉnh/thành phố').max(100),
  isDefault: z.boolean(),
});
type AddressFormValues = z.infer<typeof addressSchema>;

const emptyForm: AddressFormValues = {
  label: '',
  contactName: '',
  phone: '',
  streetAddress: '',
  ward: '',
  district: '',
  city: '',
  isDefault: false,
};

export function AddressesPage() {
  const queryClient = useQueryClient();
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  const [editing, setEditing] = useState<Address | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const { formState, handleSubmit, register, reset } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    mode: 'onBlur',
    defaultValues: emptyForm,
  });

  const showForm = formOpen || addressesQuery.data?.length === 0;

  const saveMutation = useMutation({
    mutationFn: (input: AddressInput) =>
      editing ? updateAddress(editing.id, input) : createAddress(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setSuccessMessage(editing ? 'Địa chỉ đã được cập nhật.' : 'Địa chỉ đã được lưu.');
      setEditing(null);
      setFormOpen(false);
      reset(emptyForm);
    },
  });
  const defaultMutation = useMutation({
    mutationFn: (addressId: string) => updateAddress(addressId, { isDefault: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setSuccessMessage('Đã đổi địa chỉ mặc định.');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAddress,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setConfirmingDeleteId(undefined);
      setSuccessMessage('Địa chỉ đã được xóa.');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setSuccessMessage(undefined);
    reset(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (address: Address) => {
    setEditing(address);
    setSuccessMessage(undefined);
    reset({
      label: address.label,
      contactName: address.contactName,
      phone: address.phone,
      streetAddress: address.streetAddress,
      ward: address.ward,
      district: address.district,
      city: address.city,
      isDefault: address.isDefault,
    });
    setFormOpen(true);
  };
  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
    reset(emptyForm);
  };
  const submit = handleSubmit((values) => {
    setSuccessMessage(undefined);
    saveMutation.mutate(values);
  });

  if (addressesQuery.isPending) return <LoadingState label="Đang tải sổ địa chỉ" />;

  const confirmingDeleteAddress = addressesQuery.data?.find(
    (address) => address.id === confirmingDeleteId,
  );
  const addressMutationPending =
    saveMutation.isPending || defaultMutation.isPending || deleteMutation.isPending;

  return (
    <AccountLayout>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          actions={!showForm ? <Button onClick={openCreate}>Thêm địa chỉ</Button> : undefined}
          description="Lưu thông tin gửi và nhận thường dùng để tạo vận đơn nhanh hơn."
          eyebrow="Khách hàng"
          title="Sổ địa chỉ"
        />

        {successMessage ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-surface border border-success/30 bg-success-soft p-4 text-sm font-medium text-success"
          >
            {successMessage}
          </p>
        ) : null}

        {addressesQuery.isError ? (
          <div className="mt-8">
            <ErrorState
              message={getApiErrorMessage(addressesQuery.error)}
              onRetry={() => addressesQuery.refetch()}
              title="Không thể tải sổ địa chỉ"
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.8fr)] lg:items-start">
            <section aria-labelledby="address-list-title">
              <h2 className="sr-only" id="address-list-title">
                Địa chỉ đã lưu
              </h2>
              {addressesQuery.data?.length ? (
                <ul className="space-y-4">
                  {addressesQuery.data.map((address) => (
                    <li
                      className="rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6"
                      key={address.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-ink">{address.label}</h3>
                            {address.isDefault ? (
                              <span className="rounded-full border border-border-strong bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
                                Mặc định
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 font-semibold text-ink">
                            {address.contactName} · {address.phone}
                          </p>
                          <p className="mt-1.5 wrap-anywhere text-sm leading-6 text-muted-foreground">
                            {address.streetAddress}, {address.ward}, {address.district}, {address.city}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                        <Button
                          disabled={addressMutationPending}
                          onClick={() => openEdit(address)}
                          size="sm"
                          variant="secondary"
                        >
                          Sửa
                        </Button>
                        {!address.isDefault ? (
                          <Button
                            disabled={addressMutationPending}
                            loading={defaultMutation.isPending && defaultMutation.variables === address.id}
                            onClick={() => defaultMutation.mutate(address.id)}
                            size="sm"
                            variant="secondary"
                          >
                            Đặt mặc định
                          </Button>
                        ) : null}
                        <Button
                          disabled={addressMutationPending}
                          onClick={() => setConfirmingDeleteId(address.id)}
                          size="sm"
                          variant="danger"
                        >
                          Xóa
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  description="Thêm địa chỉ đầu tiên; hệ thống sẽ tự đặt địa chỉ đó làm mặc định."
                  title="Chưa có địa chỉ đã lưu"
                />
              )}
              <div className="mt-4">
                <ErrorSummary
                  message={
                    defaultMutation.isError
                      ? getApiErrorMessage(defaultMutation.error)
                      : deleteMutation.isError
                        ? getApiErrorMessage(deleteMutation.error)
                        : undefined
                  }
                />
              </div>
            </section>

            {showForm ? (
              <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6" aria-labelledby="address-form-title">
                <h2 className="text-xl font-semibold text-ink" id="address-form-title">
                  {editing ? 'Chỉnh sửa địa chỉ' : 'Thêm địa chỉ'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Thông tin này chỉ được dùng khi bạn chọn địa chỉ cho vận đơn.
                </p>
                <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
                  <ErrorSummary
                    message={saveMutation.isError ? getApiErrorMessage(saveMutation.error) : undefined}
                  />
                  <FormField error={formState.errors.label?.message} id="address-label" label="Tên gợi nhớ" placeholder="Nhà riêng, Công ty" {...register('label')} />
                  <FormField autoComplete="name" error={formState.errors.contactName?.message} id="address-contact" label="Tên người liên hệ" {...register('contactName')} />
                  <FormField autoComplete="tel" error={formState.errors.phone?.message} id="address-phone" label="Số điện thoại" type="tel" {...register('phone')} />
                  <FormField autoComplete="street-address" error={formState.errors.streetAddress?.message} id="address-street" label="Số nhà, tên đường" {...register('streetAddress')} />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField error={formState.errors.ward?.message} id="address-ward" label="Phường / xã" {...register('ward')} />
                    <FormField error={formState.errors.district?.message} id="address-district" label="Quận / huyện" {...register('district')} />
                  </div>
                  <FormField error={formState.errors.city?.message} id="address-city" label="Tỉnh / thành phố" {...register('city')} />
                  <label className="ui-transition flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-surface-subtle px-4 py-3 font-medium text-ink transition-colors hover:border-border-strong hover:bg-primary-soft/50" htmlFor="address-default">
                    <input className="size-5 accent-primary" id="address-default" type="checkbox" {...register('isDefault')} />
                    Dùng làm địa chỉ mặc định
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button className="w-full sm:w-auto" loading={saveMutation.isPending} type="submit">
                      {editing ? 'Lưu thay đổi' : 'Lưu địa chỉ'}
                    </Button>
                    {addressesQuery.data?.length ? (
                      <Button
                        className="w-full sm:w-auto"
                        disabled={saveMutation.isPending}
                        onClick={closeForm}
                        variant="secondary"
                      >
                        Hủy
                      </Button>
                    ) : null}
                  </div>
                </form>
              </section>
            ) : (
              <aside className="rounded-surface border border-border-strong bg-primary-soft/60 p-5 sm:p-6">
                <h2 className="font-semibold text-ink">Mẹo tạo vận đơn nhanh</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Đặt địa chỉ dùng thường xuyên làm mặc định. Khi tạo vận đơn, dữ liệu sẽ được sao chụp để thay đổi sau này không ảnh hưởng lịch sử.
                </p>
              </aside>
            )}
          </div>
        )}
        <ConfirmDialog
          confirmLabel="Xóa địa chỉ"
          description={
            confirmingDeleteAddress
              ? `Địa chỉ “${confirmingDeleteAddress.label}” sẽ bị xóa khỏi sổ địa chỉ của bạn.`
              : 'Địa chỉ này sẽ bị xóa khỏi sổ địa chỉ của bạn.'
          }
          destructive
          loading={deleteMutation.isPending}
          onCancel={() => setConfirmingDeleteId(undefined)}
          onConfirm={() => {
            if (confirmingDeleteId) deleteMutation.mutate(confirmingDeleteId);
          }}
          open={Boolean(confirmingDeleteId)}
          title="Xác nhận xóa địa chỉ"
        />
      </div>
    </AccountLayout>
  );
}
