import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { Location } from '@/types'
import { locations as locationsApi } from '@/services/api'

interface LocationsState {
  locations: Location[]
  loading: boolean
  error: string | null
}

const initialState: LocationsState = {
  locations: [],
  loading: false,
  error: null,
}

export const fetchLocations = createAsyncThunk(
  'locations/fetchLocations',
  async () => {
    return await locationsApi.list()
  },
)

export const createLocation = createAsyncThunk(
  'locations/createLocation',
  async (data: Partial<Location>) => {
    return await locationsApi.create(data)
  },
)

export const updateLocation = createAsyncThunk(
  'locations/updateLocation',
  async ({ id, data }: { id: string; data: Partial<Location> }) => {
    return await locationsApi.update(id, data)
  },
)

export const deleteLocation = createAsyncThunk(
  'locations/deleteLocation',
  async (id: string) => {
    await locationsApi.delete(id)
    return id
  },
)

const locationsSlice = createSlice({
  name: 'locations',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchLocations.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(fetchLocations.fulfilled, (state, action) => {
      state.loading = false
      state.locations = action.payload
    })
    builder.addCase(fetchLocations.rejected, (state, action) => {
      state.loading = false
      state.error = action.error.message || 'Failed to fetch locations'
    })

    builder.addCase(createLocation.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(createLocation.fulfilled, (state, action) => {
      state.loading = false
      state.locations.push(action.payload)
    })
    builder.addCase(createLocation.rejected, (state, action) => {
      state.loading = false
      state.error = action.error.message || 'Failed to create location'
    })

    builder.addCase(updateLocation.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(updateLocation.fulfilled, (state, action) => {
      state.loading = false
      const index = state.locations.findIndex((l) => l.id === action.payload.id)
      if (index !== -1) {
        state.locations[index] = action.payload
      }
    })
    builder.addCase(updateLocation.rejected, (state, action) => {
      state.loading = false
      state.error = action.error.message || 'Failed to update location'
    })

    builder.addCase(deleteLocation.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(deleteLocation.fulfilled, (state, action) => {
      state.loading = false
      state.locations = state.locations.filter((l) => l.id !== action.payload)
    })
    builder.addCase(deleteLocation.rejected, (state, action) => {
      state.loading = false
      state.error = action.error.message || 'Failed to delete location'
    })
  },
})

export const { clearError } = locationsSlice.actions
export default locationsSlice.reducer
