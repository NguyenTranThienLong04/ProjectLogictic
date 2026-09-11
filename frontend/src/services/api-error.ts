import axios from 'axios';
import type { ApiErrorBody } from '../types/auth';

export function getApiErrorMessage(error: unknown): string {
  if (!axios.isAxiosError<ApiErrorBody>(error)) {
    return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  }

  if (error.code === 'ECONNABORTED') {
    return 'Yêu cầu mất quá nhiều thời gian. Vui lòng kiểm tra kết nối và thử lại.';
  }

  const message = error.response?.data?.message;
  if (Array.isArray(message)) {
    return message.join('. ');
  }
  if (typeof message === 'string') {
    return message;
  }

  return 'Không thể kết nối tới hệ thống. Vui lòng thử lại.';
}
