import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'
import playersReducer from './playersSlice'
import groupsReducer from './groupsSlice'
import locationsReducer from './locationsSlice'
import playlistsReducer from './playlistsSlice'
import deployReducer from './deploySlice'

export const store = configureStore({
  reducer: {
    players: playersReducer,
    groups: groupsReducer,
    locations: locationsReducer,
    playlists: playlistsReducer,
    deploy: deployReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
