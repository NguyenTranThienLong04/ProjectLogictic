import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { TowerFilters, TowerSnapshot } from './control-tower-types';

export async function getControlTower(params: URLSearchParams, signal?: AbortSignal) {
  return (await api.get<ApiEnvelope<TowerSnapshot>>('/control-tower', { params, signal })).data
    .data;
}
export async function getControlTowerFilters() {
  return (await api.get<ApiEnvelope<TowerFilters>>('/control-tower/filters')).data.data;
}
