import React, { useRef, useState, useEffect } from 'react';
import { SafeAreaView, StyleSheet, BackHandler, ActivityIndicator, View, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';

const APP_URL = 'https://sayset.fit';

// Google blocks OAuth inside embedded WebViews, so hide the Google button in the
// wrapped app — email/password is the reliable in-app login.
const INJECT = `
  (function () {
    var s = document.createElement('style');
    s.textContent = '#googleBtn,.auth-divider{display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  })(); true;
`;

export default function App() {
  const webRef = useRef(null);
  const canGoBack = useRef(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // request the mic up-front so voice logging works inside the WebView
    Audio.requestPermissionsAsync().catch(() => {});
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && webRef.current) { webRef.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  // keep the app + its backend in the WebView; send everything else to the system browser
  const onShouldStart = (req) => {
    const url = req.url || '';
    if (url.startsWith('mailto:') || url.startsWith('tel:')) { Linking.openURL(url); return false; }
    const internal = /(^https?:\/\/(www\.)?sayset\.fit)|(xfvpijvpfmgstmevkhey\.supabase\.co)/.test(url);
    if (!internal && /^https?:/.test(url)) { Linking.openURL(url); return false; }
    return true;
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#120d0a" />
      <WebView
        ref={webRef}
        source={{ uri: APP_URL }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        injectedJavaScript={INJECT}
        setSupportMultipleWindows={false}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(s) => { canGoBack.current = s.canGoBack; }}
        onShouldStartLoadWithRequest={onShouldStart}
      />
      {loading && (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator size="large" color="#ffb020" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#120d0a' },
  web: { flex: 1, backgroundColor: '#120d0a' },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#120d0a',
  },
});
