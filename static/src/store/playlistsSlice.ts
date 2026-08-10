import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { Playlist } from '@/types'
import { playlists as playlistsApi } from '@/services/api'

interface PlaylistsState {
  playlists: Playlist[]
  loading: boolean
  error: string | null
}

const initialState: PlaylistsState = {
  playlists: [],
  loading: false,
  error: null,
}

export const fetchPlaylists = createAsyncThunk(
  'playlists/fetchPlaylists',
  async () => {
    return await playlistsApi.list()
  },
)

export const createPlaylist = createAsyncThunk(
  'playlists/createPlaylist',
  async (data: Partial<Playlist>) => {
    return await playlistsApi.create(data)
  },
)

export const updatePlaylist = createAsyncThunk(
  'playlists/updatePlaylist',
  async ({ id, data }: { id: string; data: Partial<Playlist> }) => {
    return await playlistsApi.update(id, data)
  },
)

export const deletePlaylist = createAsyncThunk(
  'playlists/deletePlaylist',
  async (id: string) => {
    await playlistsApi.delete(id)
    return id
  },
)

export const deployPlaylist = createAsyncThunk(
  'playlists/deployPlaylist',
  async (id: string) => {
    return await playlistsApi.deploy(id)
  },
)

const playlistsSlice = createSlice({
  name: 'playlists',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchPlaylists.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(fetchPlaylists.fulfilled, (state, action) => {
      state.loading = false
      state.playlists = action.payload
    })
    builder.addCase(fetchPlaylists.rejected, (state, action) => {
      state.loading = false
      state.error = action.error.message || 'Failed to fetch playlists'
    })

    builder.addCase(createPlaylist.fulfilled, (state, action) => {
      state.playlists.push(action.payload)
    })

    builder.addCase(updatePlaylist.fulfilled, (state, action) => {
      const index = state.playlists.findIndex((p) => p.id === action.payload.id)
      if (index !== -1) {
        state.playlists[index] = action.payload
      }
    })

    builder.addCase(deletePlaylist.fulfilled, (state, action) => {
      state.playlists = state.playlists.filter((p) => p.id !== action.payload)
    })
  },
})

export const { clearError } = playlistsSlice.actions
export default playlistsSlice.reducer
