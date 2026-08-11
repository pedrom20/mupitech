import Swal from 'sweetalert2'

/**
 * Non-blocking notification in the top-right corner instead of a
 * full centered modal — for low-stakes feedback (e.g. "saved",
 * "action failed") that doesn't need the user to dismiss it.
 * Hovering pauses the auto-dismiss timer (SweetAlert2's toast mode
 * does this natively).
 */
export function showToast(icon: 'success' | 'error' | 'warning' | 'info', title: string, text?: string) {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon,
    title,
    text,
    showConfirmButton: false,
    timer: text ? 4000 : 3000,
    timerProgressBar: true,
    didOpen: (el) => {
      el.addEventListener('mouseenter', Swal.stopTimer)
      el.addEventListener('mouseleave', Swal.resumeTimer)
    },
  })
}
