import { useEffect, useState } from 'react'
import type { DeviceType } from '../types'

/**
 * 检测当前设备类型（手机/平板/桌面）
 */
export function useDeviceType(): DeviceType {
  const [device, setDevice] = useState<DeviceType>('desktop')

  useEffect(() => {
    const check = () => {
      const width = window.innerWidth
      if (width < 768) setDevice('mobile')
      else if (width < 1024) setDevice('tablet')
      else setDevice('desktop')
    }

    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return device
}

/**
 * 检测是否在线
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
