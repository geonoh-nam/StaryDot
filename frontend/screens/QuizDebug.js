// Every question the pipeline authored, listed so we can jump the video to the moment it fires.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { QUIZ_KINDS } from '../data/quiz-pool';
import { TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { QUIZ_POOL } from '../data/quiz-pool';
import { OFFLINE_ACTIVITIES } from '../data/activities';

// Content check without watching a video to the right second: every authored question, openable.
export function QuizDebugScreen({ onPlay }) {
  return (
    <ScrollView contentContainerStyle={styles.qdBody} showsVerticalScrollIndicator={false}>
      {Object.entries(OFFLINE_ACTIVITIES).map(([videoId, activities]) => (
        <View key={videoId} style={styles.qdGroup}>
          <Text style={styles.qdVideo}>{videoId} · {activities.length}개</Text>
          {activities.map((a) => {
            const payload = typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {};
            return (
              <TouchableOpacity
                key={a.id}
                style={styles.qdRow}
                onPress={() => onPlay({ ...payload, kind: payload.activity_template }, videoId, a.at ?? a.at_sec)}
              >
                <Text style={styles.qdAt}>{a.at ?? a.at_sec}s</Text>
                <View style={styles.qdText}>
                  <Text style={styles.qdKind}>{payload.activity_template || a.type}</Text>
                  <Text style={styles.qdTitle} numberOfLines={1}>{payload.title || '(퍼즐)'}</Text>
                </View>
                <Text style={styles.qdAnswer}>{payload.answer || ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <Text style={styles.qdVideo}>데모 문제 · {QUIZ_POOL.length}개</Text>
      {QUIZ_POOL.map((q, i) => (
        <TouchableOpacity key={q.kind + i} style={styles.qdRow} onPress={() => onPlay(q)}>
          <Text style={styles.qdAt}>데모</Text>
          <View style={styles.qdText}>
            <Text style={styles.qdKind}>{QUIZ_KINDS[q.kind] || q.kind}</Text>
            <Text style={styles.qdTitle} numberOfLines={1}>{q.title}</Text>
          </View>
          <Text style={styles.qdAnswer}>{q.answer}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  qdAnswer: {
    fontSize: 13,
    fontWeight: '900',
    color: '#2f8f5b',
  },
  qdAt: {
    width: 46,
    fontSize: 12,
    fontWeight: '900',
    color: '#609EF5',
  },
  qdBody: {
    gap: 8,
    paddingBottom: 24,
  },
  qdGroup: {
    gap: 6,
  },
  qdKind: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8a97b1',
  },
  qdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  qdText: {
    flex: 1,
  },
  qdTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  qdVideo: {
    paddingTop: 8,
    fontSize: 13,
    fontWeight: '900',
    color: '#5b6b8c',
  },
});
