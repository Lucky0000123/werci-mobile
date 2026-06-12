/**
 * Simple Notification Service
 * Uses Local Notifications (works without Firebase)
 */

export interface NotificationPayload {
  title: string
  body: string
  data?: Record<string, any>
}

class NotificationService {


  async initialize(): Promise<boolean> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      
      const { display } = await LocalNotifications.requestPermissions()
      
      if (display === 'granted') {
        console.log('✅ Notifications initialized')
        return true
      }
      
      return false
    } catch (error) {
      console.log('Local notifications not available')
      return false
    }
  }

  async showNotification(payload: NotificationPayload): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')

      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now(),
            title: payload.title,
            body: payload.body,
            extra: payload.data || {}
          }
        ]
      })
    } catch (error) {
      console.error('Failed to show notification:', error)
    }
  }

  async notifySyncComplete(recordCount: number): Promise<void> {
    await this.showNotification({
      title: '✅ Sync Complete',
      body: `${recordCount} records synchronized successfully`,
      data: { type: 'sync_complete' }
    })
  }

  async notifySyncFailed(error: string): Promise<void> {
    await this.showNotification({
      title: '❌ Sync Failed',
      body: error,
      data: { type: 'sync_failed' }
    })
  }

  async sendTestNotification(): Promise<void> {
    await this.showNotification({
      title: 'WBNKIS Test',
      body: 'Push notifications are working! 🎉',
      data: { type: 'test' }
    })
  }
}

export const notifications = new NotificationService()
export default notifications
