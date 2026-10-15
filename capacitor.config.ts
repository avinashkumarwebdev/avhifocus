import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.avhifocus.app',
  appName: 'AVHIFocus',
  webDir: 'dist',
  backgroundColor: '#F7F1E4',
  android: {
    // the web app talks to Supabase over HTTPS — allowed mixed content not needed
    allowMixedContent: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#2F5941'
    }
  }
}

export default config
