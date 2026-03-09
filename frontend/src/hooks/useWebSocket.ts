import { useEffect, useRef, useCallback } from 'react'

export function useWebSocket(raceId: number | null, onMessage: (data: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback(() => {
    if (!raceId) return
    const url = `ws://${window.location.host}/ws/races/${raceId}`
    const ws = new WebSocket(url)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      // Prøv å koble til igjen etter 2 sekunder
      setTimeout(connect, 2000)
    }

    wsRef.current = ws
  }, [raceId, onMessage])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])
}
