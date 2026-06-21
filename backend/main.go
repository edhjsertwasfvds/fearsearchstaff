package main

import (
	"log"
	"net/http"

	"github.com/rs/cors"

	"fearstaff-api/config"
	"fearstaff-api/database"
	"fearstaff-api/handlers"
)

func main() {
	cfg := config.Load()

	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Printf("⚠️ Database error: %v (continuing with file fallback)", err)
	}
	defer db.Close()

	auth := handlers.NewAuthHandler(cfg, db)
	users := handlers.NewUserHandler(cfg, db)
	checker := handlers.NewCheckHandler(cfg, db)
	fearAPI := handlers.NewFearAPIHandler(cfg)
	admin := handlers.NewAdminHandler(cfg, db)
	whitelist := handlers.NewWhitelistHandler(cfg)
	evaders := handlers.NewEvadersHandler(cfg, db)
	vdfHistory := handlers.NewVDFHistoryHandler(cfg, db)

	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/login", auth.LoginURL)
	mux.HandleFunc("/api/auth/callback", auth.Callback)
	mux.Handle("/api/auth/me", handlers.AuthMiddleware(cfg, http.HandlerFunc(auth.Me)))

	mux.Handle("/api/staff", handlers.AuthMiddleware(cfg, http.HandlerFunc(users.GetStaff)))
	mux.Handle("/api/staff/group", handlers.AuthMiddleware(cfg, http.HandlerFunc(users.GetStaffByGroup)))
	mux.Handle("/api/roles", handlers.AuthMiddleware(cfg, http.HandlerFunc(users.GetRoles)))
	mux.Handle("/api/dashboard/stats", handlers.AuthMiddleware(cfg, http.HandlerFunc(users.GetDashboardStats)))

	mux.Handle("/api/admin/users", handlers.AuthMiddleware(cfg, http.HandlerFunc(admin.GetUsers)))
	mux.Handle("/api/admin/user/level", handlers.AuthMiddleware(cfg, http.HandlerFunc(admin.UpdateUserLevel)))
	mux.Handle("/api/admin/user/block", handlers.AuthMiddleware(cfg, http.HandlerFunc(admin.BlockUser)))

	mux.Handle("/api/whitelist", handlers.AuthMiddleware(cfg, http.HandlerFunc(whitelist.GetEntries)))
	mux.Handle("/api/whitelist/add", handlers.AuthMiddleware(cfg, http.HandlerFunc(whitelist.AddEntry)))
	mux.Handle("/api/whitelist/delete", handlers.AuthMiddleware(cfg, http.HandlerFunc(whitelist.DeleteEntry)))

	mux.Handle("/api/servers", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetServers)))
	mux.Handle("/api/leaderboard", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetLeaderboard)))
	mux.Handle("/api/profile/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetProfile)))
	mux.Handle("/api/skinchanger/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetSkinchanger)))
	mux.Handle("/api/punishments", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetPunishments)))
	mux.Handle("/api/punishments/search", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.SearchPunishments)))
	mux.Handle("/api/punishments/all", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetAllPunishments)))
	mux.Handle("/api/punishments/admin", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetPunishmentsByAdmin)))
	mux.Handle("/api/punishments/staff-stats", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetStaffStats)))
	mux.Handle("/api/bans/check/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.CheckBan)))

	mux.Handle("/api/yooma/bans/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetYoomaBans)))
	mux.Handle("/api/steam/summary/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetSteamSummary)))
	mux.Handle("/api/steam/bans/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetSteamBans)))
	mux.Handle("/api/steam/friends/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetSteamFriends)))
	mux.Handle("/api/steam/level/", handlers.AuthMiddleware(cfg, http.HandlerFunc(fearAPI.GetSteamLevel)))

	mux.Handle("/api/check", handlers.AuthMiddleware(cfg, http.HandlerFunc(checker.Check)))
	mux.Handle("/api/check/search", handlers.AuthMiddleware(cfg, http.HandlerFunc(checker.Search)))
	mux.Handle("/api/evaders", handlers.AuthMiddleware(cfg, http.HandlerFunc(evaders.GetEvaders)))
	mux.Handle("/api/vdf-history", handlers.AuthMiddleware(cfg, http.HandlerFunc(vdfHistory.GetHistory)))

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"fearstaff-api"}`))
	})

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{cfg.FrontendURL, "https://fearsearchstaff.vercel.app", "http://localhost:5173", "http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	handler := c.Handler(mux)

	log.Printf("🚀 FearStaff API running on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		log.Fatal(err)
	}
}
