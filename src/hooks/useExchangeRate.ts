import { useCallback, useEffect, useState } from 'react'
import { fetchUsdCnyRate, type ExchangeRateInfo } from '../lib/exchangeRate'

const FALLBACK: ExchangeRateInfo = {
  rate: 7.2,
  updatedAt: '',
  source: 'fallback',
  fromCache: false,
}

export function useExchangeRate() {
  const [info, setInfo] = useState<ExchangeRateInfo>(FALLBACK)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const next = await fetchUsdCnyRate(force)
      setInfo(next)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh(false)
  }, [refresh])

  return { ...info, loading, refresh }
}
