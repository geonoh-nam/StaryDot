// The bar every screen wears: the wordmark on the left, and a menu on the right that opens
// the places a grown-up can go.
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { playSound } from '../sound';
import { StaryLogo } from './Logo';
import { COLORS, TEXT_ON_DARK } from '../theme';

// Shared with the star's menu on the main screen, which lists the same places.
export const SETTINGS_ICON = require('../assets/scenes/settings.png');

export const TABS = [
  { key: 'library', label: '영상', icon: '▶' },
  { key: 'parent', label: '부모 리포트', icon: '▤' },
  { key: 'character', label: '캐릭터', icon: '★' },
  { key: 'words', label: '단어장', icon: '가' },
  { key: 'settings', label: '설정', art: SETTINGS_ICON },
];

export function TabletHeader({ rightLabel, onHome, onReport, onTab }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onHome}>
        <StaryLogo size={20} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.headerMenu} onPress={() => (onTab ? setOpen((v) => !v) : onReport())} accessibilityLabel={rightLabel}>
        <View style={styles.headerMenuLine} />
        <View style={styles.headerMenuLine} />
        <View style={styles.headerMenuLine} />
      </TouchableOpacity>

      {open ? (
        <>
          <Pressable style={styles.headerSheetBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.headerSheet}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={styles.headerSheetItem}
                onPress={() => { setOpen(false); playSound('pop'); onTab(t.key); }}
              >
                {t.art ? (
                  <Image source={t.art} style={styles.headerSheetArt} resizeMode="contain" />
                ) : (
                  <Text style={styles.headerSheetIcon}>{t.icon}</Text>
                )}
                <Text style={styles.headerSheetText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.headerSheetDivider} />
            <TouchableOpacity style={styles.headerSheetItem} onPress={() => { setOpen(false); onReport(); }}>
              <Text style={styles.headerSheetIcon}>▤</Text>
              <Text style={styles.headerSheetText}>활동 리포트</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 76,
    paddingHorizontal: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f4f7fe',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  headerMenu: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  headerMenuLine: {
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: TEXT_ON_DARK,
  },
  headerSheet: {
    position: 'absolute',
    top: 68,
    right: 24,
    minWidth: 176,
    borderRadius: 18,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#0b1c4a',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 70,
  },
  headerSheetArt: {
    width: 17,
    height: 17,
  },
  headerSheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4000,
    zIndex: 60,
  },
  headerSheetDivider: {
    height: 1,
    marginVertical: 4,
    backgroundColor: '#eef2fb',
  },
  headerSheetIcon: {
    fontSize: 15,
    color: '#609EF5',
  },
  headerSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  headerSheetText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#171d31',
  },
});
