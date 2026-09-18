import { useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { SelectField } from '../../components/ui/select-field';
import type { Address } from '../addresses/address-api';
import { getDeliveryAddressContext, type ShipmentFormValues } from './shipment-form';
import { LocationPicker } from '../locations/location-picker';
import { AdministrativeAddressFields } from '../addresses/administrative-address-fields';
import { SHIPPING_FEE_PAYER_OPTIONS } from './shipping-fee-payer';

interface ShipmentFormFieldsProps {
  control: Control<ShipmentFormValues>;
  setValue: UseFormSetValue<ShipmentFormValues>;
  addresses: Address[];
  errors: FieldErrors<ShipmentFormValues>;
  register: UseFormRegister<ShipmentFormValues>;
}

export function ShipmentFormFields({ addresses, errors, register, control, setValue }: ShipmentFormFieldsProps) {
  const values = useWatch({ control });
  const deliveryAddressContext = getDeliveryAddressContext(values);
  const deliveryLocation = values.deliveryLatitude !== undefined && values.deliveryLongitude !== undefined
    ? { latitude: values.deliveryLatitude, longitude: values.deliveryLongitude } : undefined;
  const onDeliveryAddress = (address: { city: string; ward: string; district: string }) => {
    setValue('deliveryCity', address.city, { shouldDirty: true, shouldValidate: true });
    setValue('deliveryWard', address.ward, { shouldDirty: true, shouldValidate: true });
    setValue('deliveryDistrict', address.district, { shouldDirty: true });
  };
  const onDeliveryLocation = (point: { latitude: number; longitude: number }, fingerprint: string) => {
    setValue('deliveryLatitude', point.latitude, { shouldDirty: true });
    setValue('deliveryLongitude', point.longitude, { shouldDirty: true });
    setValue('confirmedAddressFingerprint', fingerprint, { shouldDirty: true, shouldValidate: true });
  };
  return (
    <div className="space-y-6">
      <fieldset className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6">
        <legend className="px-2 text-lg font-semibold text-ink">1. Địa chỉ lấy hàng</legend>
        {addresses.length ? (
          <SelectField
            error={errors.pickupAddressId?.message}
            id="shipment-pickup-address"
            label="Địa chỉ đã lưu"
            {...register('pickupAddressId')}
          >
            <option value="">Chọn địa chỉ lấy hàng</option>
            {addresses.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label} — {address.streetAddress}, {address.city}
              </option>
            ))}
          </SelectField>
        ) : (
          <EmptyState
            action={
              <Link
                className="focus-ring ui-transition inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-4 text-sm font-semibold text-primary shadow-surface transition-colors hover:border-primary hover:bg-primary-soft"
                to="/addresses"
              >
                Mở sổ địa chỉ
              </Link>
            }
            compact
            description="Bạn cần lưu ít nhất một địa chỉ lấy hàng trước khi tiếp tục."
            title="Chưa có địa chỉ lấy hàng"
          />
        )}
      </fieldset>

      <fieldset className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6">
        <legend className="px-2 text-lg font-semibold text-ink">2. Người nhận và nơi giao</legend>
        <div className="mt-2 grid gap-5 sm:grid-cols-2">
          <FormField
            autoComplete="name"
            error={errors.deliveryContactName?.message}
            id="delivery-contact"
            label="Tên người nhận"
            {...register('deliveryContactName')}
          />
          <FormField
            autoComplete="tel"
            error={errors.deliveryPhone?.message}
            id="delivery-phone"
            label="Số điện thoại"
            type="tel"
            {...register('deliveryPhone')}
          />
          <div className="sm:col-span-2">
            <FormField
              autoComplete="street-address"
              error={errors.deliveryStreetAddress?.message}
              id="delivery-street"
              label="Số nhà, tên đường"
              {...register('deliveryStreetAddress')}
            />
          </div>
          <div className="sm:col-span-2">
            <AdministrativeAddressFields city={deliveryAddressContext.city} ward={deliveryAddressContext.ward}
              cityError={errors.deliveryCity?.message} wardError={errors.deliveryWard?.message} onChange={onDeliveryAddress} />
          </div>
          <div className="sm:col-span-2">
            <LocationPicker label="Vị trí giao hàng (tùy chọn)" value={deliveryLocation} onChange={onDeliveryLocation} addressContext={deliveryAddressContext} confirmedAddressFingerprint={values.confirmedAddressFingerprint} />
          </div>
        </div>
      </fieldset>

      <fieldset className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6">
        <legend className="px-2 text-lg font-semibold text-ink">3. Kiện hàng và COD</legend>
        <div className="mt-2 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField
              error={errors.description?.message}
              id="package-description"
              label="Mô tả hàng hóa"
              {...register('description')}
            />
          </div>
          <SelectField
            error={errors.packageType?.message}
            id="package-type"
            label="Loại kiện"
            {...register('packageType')}
          >
            <option value="PARCEL">Bưu kiện</option>
            <option value="DOCUMENT">Tài liệu</option>
            <option value="FRAGILE">Hàng dễ vỡ</option>
          </SelectField>
          <FormField
            error={errors.weightGrams?.message}
            helperText="1.000 gram đầu đã gồm trong phí cơ bản."
            id="package-weight"
            inputMode="numeric"
            label="Khối lượng (gram)"
            min="1"
            type="number"
            {...register('weightGrams', { valueAsNumber: true })}
          />
          <FormField
            error={errors.lengthCm?.message}
            id="package-length"
            inputMode="decimal"
            label="Dài (cm)"
            min="1"
            step="0.1"
            type="number"
            {...register('lengthCm', { valueAsNumber: true })}
          />
          <FormField
            error={errors.widthCm?.message}
            id="package-width"
            inputMode="decimal"
            label="Rộng (cm)"
            min="1"
            step="0.1"
            type="number"
            {...register('widthCm', { valueAsNumber: true })}
          />
          <FormField
            error={errors.heightCm?.message}
            id="package-height"
            inputMode="decimal"
            label="Cao (cm)"
            min="1"
            step="0.1"
            type="number"
            {...register('heightCm', { valueAsNumber: true })}
          />
          <FormField
            error={errors.codAmount?.message}
            helperText="Nhập 0 nếu không thu hộ."
            id="package-cod"
            inputMode="numeric"
            label="Tiền thu hộ COD (VND)"
            min="0"
            type="number"
            {...register('codAmount', { valueAsNumber: true })}
          />
        </div>
      </fieldset>

      <fieldset
        aria-describedby={errors.shippingFeePayer ? 'shipping-fee-payer-help shipping-fee-payer-error' : 'shipping-fee-payer-help'}
        className="min-w-0 rounded-surface border border-border bg-surface p-4 shadow-surface sm:p-6"
      >
        <legend className="px-2 text-lg font-semibold text-ink">
          4. Người chịu phí vận chuyển <span className="text-danger" aria-hidden="true">*</span>
        </legend>
        <p className="mt-2 text-sm leading-6 text-muted-foreground" id="shipping-fee-payer-help">
          Chọn rõ bên chịu trách nhiệm thanh toán. Lựa chọn này không làm thay đổi báo giá hoặc tiền thu hộ COD.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SHIPPING_FEE_PAYER_OPTIONS.map((option) => (
            <label
              className="focus-within:ring-focus flex min-h-16 cursor-pointer items-start gap-3 rounded-control border border-border bg-surface-subtle p-4 transition-colors hover:border-primary has-[:checked]:border-primary has-[:checked]:bg-primary-soft focus-within:ring-2 focus-within:ring-offset-2"
              key={option.value}
            >
              <input
                aria-describedby={errors.shippingFeePayer ? 'shipping-fee-payer-help shipping-fee-payer-error' : 'shipping-fee-payer-help'}
                aria-invalid={Boolean(errors.shippingFeePayer)}
                className="mt-0.5 size-5 shrink-0 accent-primary"
                required
                type="radio"
                value={option.value}
                {...register('shippingFeePayer')}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{option.label}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.shippingFeePayer ? (
          <p className="mt-3 text-sm font-medium text-danger" id="shipping-fee-payer-error" role="alert">
            {errors.shippingFeePayer.message}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
