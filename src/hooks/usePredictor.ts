import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStats,
  getHealth,
  getHouses,
  getHistory,
  getPredictions,
  getPredictionHistory,
  getActiveModel,
  getJobs,
  getJob,
  executeCommand,
  cancelJob,
  listBatches,
  getBatch,
  startBatch,
  cancelBatch,
  getDataQuality,
  getGenericModel,
  setGenericModel,
  PredictorCommandPayload,
  TrainingJob,
  BatchOptions,
} from "../api/predictorApi";

export function usePredictorStats() {
  return useQuery({
    queryKey: ["predictor", "stats"],
    queryFn: getStats,
    refetchInterval: 15000,
  });
}

export function usePredictorHealth() {
  return useQuery({
    queryKey: ["predictor", "health"],
    queryFn: getHealth,
    refetchInterval: 30000,
  });
}

export function usePredictorHouses() {
  return useQuery({
    queryKey: ["predictor", "houses_v2"],
    queryFn: getHouses,
    staleTime: 60000,
    // Houses are added and removed by editing the predictor's config files.
    refetchInterval: 300000,
  });
}

export function usePredictorHistory(houseId: string | null, days: number = 3) {
  return useQuery({
    queryKey: ["predictor", "history_v2", houseId, days],
    queryFn: () => getHistory(houseId!, days),
    enabled: !!houseId,
    refetchInterval: 60000,
  });
}

export function usePredictorPredictions(houseId: string | null) {
  return useQuery({
    queryKey: ["predictor", "predictions_v2", houseId],
    queryFn: () => getPredictions(houseId!),
    enabled: !!houseId,
    refetchInterval: 60000, // Every minute
  });
}

export function usePredictorPredictionHistory(houseId: string | null) {
  const consumption = useQuery({
    queryKey: ["predictor", "prediction-history", houseId, "consumption"],
    queryFn: () => getPredictionHistory(houseId!, "consumption"),
    enabled: !!houseId,
    refetchInterval: 60000,
  });
  const production = useQuery({
    queryKey: ["predictor", "prediction-history", houseId, "production"],
    queryFn: () => getPredictionHistory(houseId!, "production"),
    enabled: !!houseId,
    refetchInterval: 60000,
  });
  return { consumption, production };
}

export function usePredictorActiveModel(houseId: string | null) {
  return useQuery({
    queryKey: ["predictor", "active-model", houseId],
    queryFn: () => getActiveModel(houseId!),
    enabled: !!houseId,
    refetchInterval: 60000,
  });
}

export function usePredictorTrainingProgress() {
  return useQuery({
    queryKey: ["predictor", "jobs"],
    queryFn: getJobs,
    refetchInterval: 2000,
  });
}

const TERMINAL_JOB_STATUSES = ["ACCEPTED", "REJECTED", "CANCELED", "FAILED"];

/** One training job, polled until it reaches a terminal state. */
export function usePredictorJob(jobId: string | null, initial?: TrainingJob) {
  return useQuery({
    queryKey: ["predictor", "jobs", jobId],
    queryFn: () => getJob(jobId!),
    enabled: !!jobId,
    placeholderData: initial,
    refetchInterval: (query) => (TERMINAL_JOB_STATUSES.includes(query.state.data?.status ?? "") ? false : 2000),
  });
}

export function usePredictorCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PredictorCommandPayload) => executeCommand(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["predictor", "jobs"] });
    },
  });
}

export function useCancelTrainingJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["predictor", "jobs"] });
    },
  });
}

/** Training batches; polled faster while one is running. */
export function usePredictorBatches() {
  return useQuery({
    queryKey: ["predictor", "batches"],
    queryFn: listBatches,
    refetchInterval: (query) => (query.state.data?.some((b) => b.status === "RUNNING") ? 3000 : 15000),
  });
}

/** One batch with its items, polled while it runs. */
export function usePredictorBatch(batchId: string | null) {
  return useQuery({
    queryKey: ["predictor", "batches", batchId],
    queryFn: () => getBatch(batchId!),
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data?.status === "RUNNING" ? 3000 : false),
  });
}

export function useStartBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: BatchOptions) => startBatch(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["predictor", "batches"] });
      queryClient.invalidateQueries({ queryKey: ["predictor", "jobs"] });
    },
  });
}

export function useCancelBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => cancelBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["predictor", "batches"] });
      queryClient.invalidateQueries({ queryKey: ["predictor", "jobs"] });
    },
  });
}

/** How the house's meters are read and the quality of the latest forecast window. */
export function usePredictorDataQuality(houseId: string | null) {
  return useQuery({
    queryKey: ["predictor", "data-quality", houseId],
    queryFn: () => getDataQuality(houseId!),
    enabled: !!houseId,
    refetchInterval: 60000,
    // Older predictor builds have no such endpoint; the panel just stays hidden.
    retry: false,
  });
}

/** The generic (cold-start) model per lane: chosen backend, trained backends and the houses they pooled. */
export function usePredictorGenericModel(enabled: boolean = true) {
  return useQuery({
    queryKey: ["predictor", "generic-model"],
    queryFn: getGenericModel,
    enabled,
    refetchInterval: 60000,
    // Older predictor builds have no such endpoint.
    retry: false,
  });
}

export function useSetGenericModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setGenericModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["predictor", "generic-model"] });
    },
  });
}
