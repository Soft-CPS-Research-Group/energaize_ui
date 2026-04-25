import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStats,
  getHouses,
  getHistory,
  getPredictions,
  getPredictionHistory,
  getJobs,
  getJob,
  executeCommand,
  cancelJob,
  PredictorCommandPayload,
} from "../api/predictorApi";

export function usePredictorStats() {
  return useQuery({
    queryKey: ["predictor", "stats"],
    queryFn: getStats,
    refetchInterval: 15000,
  });
}

export function usePredictorHouses() {
  return useQuery({
    queryKey: ["predictor", "houses_v2"],
    queryFn: getHouses,
    staleTime: 60000,
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

export function usePredictorTrainingProgress() {
  return useQuery({
    queryKey: ["predictor", "jobs"],
    queryFn: getJobs,
    refetchInterval: 5000,
  });
}

export function usePredictorJob(jobId: string | null) {
  return useQuery({
    queryKey: ["predictor", "jobs", jobId],
    queryFn: () => getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 5000,
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
