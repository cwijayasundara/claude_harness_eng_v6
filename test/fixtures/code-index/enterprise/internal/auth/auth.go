package auth

func Login() string {
	return "ok"
}

type Session struct {
	ID string
}

func (s *Session) Valid() bool {
	return s.ID != ""
}
