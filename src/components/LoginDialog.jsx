import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * Login dialog component for user authentication
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether dialog is open
 * @param {Function} props.onClose - Function to close dialog
 */
const LoginDialog = ({ isOpen, onClose }) => {
  const { login, loading, error, clearError } = useAuth();

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const rememberedUsername = localStorage.getItem('opensubtitles_remembered_username');
      if (rememberedUsername) {
        setFormData(prev => ({ ...prev, username: rememberedUsername }));
      }
    }
  }, [isOpen]);

  const handleInputChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    clearError();
    if (!formData.username || !formData.password) return;

    const result = await login(formData.username, formData.password, 'en');
    if (result.success) {
      localStorage.setItem('opensubtitles_remembered_username', formData.username);
      onClose();
      setFormData({ username: formData.username, password: '' });
    }
  };

  const handleClose = () => {
    clearError();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-box w-full max-w-md bg-base-100 p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-base-content">Login to OpenSubtitles</h2>
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-sm btn-ghost btn-square"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && (
          <div role="alert" className="alert alert-error mb-4">
            <AlertTriangle className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-base-content mb-1">
              Username
            </label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              className="input input-bordered w-full"
              placeholder="Enter your username"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-base-content mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                className="input input-bordered w-full pr-10"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !formData.username || !formData.password}
            className="btn btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Logging in…
              </>
            ) : (
              'Login'
            )}
          </button>
        </form>

        <div className="mt-4 text-center">
          <p className="text-sm text-base-content/70">
            Don't have an account?{' '}
            <a
              href="https://www.opensubtitles.com/users/sign_up"
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary link-hover font-medium"
            >
              Register on OpenSubtitles.com
            </a>
          </p>
        </div>

        <div className="mt-6 text-xs text-base-content/60 space-y-1">
          <p>
            <strong>Required:</strong> You need an OpenSubtitles.com account to upload subtitles.
          </p>
          <p>Your credentials are sent over HTTPS and only used for authentication.</p>
        </div>
      </div>
    </div>
  );
};

export default LoginDialog;
