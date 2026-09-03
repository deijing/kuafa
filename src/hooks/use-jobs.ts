import { createContext, useContext } from "react"
import type { Job } from "@/lib/api"

export type JobsContextValue = {
  jobs: Job[]
  activeJobs: Job[]
  hasActiveJobs: boolean
  overallProgress: number
  loading: boolean
  error: string | null
  refreshJobs: () => Promise<Job[]>
  registerJobs: (newJobs: Job[]) => void
  stopJob: (jobId: string) => Promise<Job | null>
  stopAllJobs: () => Promise<Job[]>
}

const JobsContext = createContext<JobsContextValue | null>(null)

export function useJobs() {
  const ctx = useContext(JobsContext)
  if (!ctx) {
    throw new Error("useJobs must be used within JobsProvider")
  }
  return ctx
}

export { JobsContext }
